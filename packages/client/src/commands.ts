import * as CSpellSettings from './settings/CSpellSettings';
import * as Settings from './settings';
import { AllTargetTypes, createConfigFileRelativeToDocumentUri } from './settings';
import {
    resolveTarget,
    determineSettingsPaths,
    ConfigurationTarget,
    setEnableSpellChecking,
    toggleEnableSpellChecker,
    enableCurrentLanguage,
    disableCurrentLanguage,
} from './settings';
import { performance, toMilliseconds } from './util/perf';

import { window, Uri, workspace, commands, WorkspaceEdit, TextDocument, Range, Diagnostic, Selection, Disposable } from 'vscode';
import { TextEdit } from 'vscode-languageclient/node';
import { SpellCheckerSettingsProperties } from './server';
import { ClientSideCommandHandlerApi } from './server';
import {
    DictionaryTargetCSpellConfig,
    DictionaryTargetDictionary,
    DictionaryTargetFolder,
    DictionaryTargets,
    DictionaryTargetTypes,
    DictionaryTargetUser,
    DictionaryTargetWorkspace,
    TargetType,
} from './settings/DictionaryTargets';
import { writeWordsToDictionary } from './settings/DictionaryWriter';
import * as di from './di';
import { getCSpellDiags } from './diags';
import { isDefined, toUri } from './util';
import { handleErrors, catchErrors } from './util/errors';

export { toggleEnableSpellChecker, enableCurrentLanguage, disableCurrentLanguage } from './settings';

const commandsFromServer: ClientSideCommandHandlerApi = {
    'cSpell.addWordsToConfigFileFromServer': (words, documentUri, config) => {
        return pVoid(writeWordsToDictionary(toDictionaryTarget('cspell', documentUri, config.name, config.uri), words));
    },
    'cSpell.addWordsToDictionaryFileFromServer': (words, documentUri, dict) => {
        return pVoid(writeWordsToDictionary(toDictionaryTarget('dictionary', documentUri, dict.name, dict.uri), words));
    },
    'cSpell.addWordsToVSCodeSettingsFromServer': (words, documentUri, target) => {
        return pVoid(writeWordsToDictionary(toDictionaryTarget(target, documentUri), words));
    },
};

type CommandHandler = {
    [key in string]: (...params: any[]) => void | Promise<void>;
};

const prompt = onCommandUseDiagsSelectionOrPrompt;
const actionAddWordToFolder = prompt('Add Word to Folder Dictionary', addWordToFolderDictionary);
const actionAddWordToWorkspace = prompt('Add Word to Workspace Dictionaries', addWordToWorkspaceDictionary);
const actionAddWordToUser = prompt('Add Word to User Dictionary', addWordToUserDictionary);
const actionRemoveWordFromFolderDictionary = prompt('Remove Word from Folder Dictionary', removeWordFromFolderDictionary);
const actionRemoveWordFromWorkspaceDictionary = prompt('Remove Word from Workspace Dictionaries', removeWordFromWorkspaceDictionary);
const actionRemoveWordFromDictionary = prompt('Remove Word from Global Dictionary', removeWordFromUserDictionary);
const actionAddIgnoreWord = prompt('Ignore Word', fnWithTarget(addIgnoreWordToTarget, ConfigurationTarget.WorkspaceFolder));
const actionAddIgnoreWordToFolder = prompt(
    'Ignore Word in Folder Settings',
    fnWithTarget(addIgnoreWordToTarget, ConfigurationTarget.WorkspaceFolder)
);
const actionAddIgnoreWordToWorkspace = prompt(
    'Ignore Word in Workspace Settings',
    fnWithTarget(addIgnoreWordToTarget, ConfigurationTarget.Workspace)
);
const actionAddIgnoreWordToUser = prompt('Ignore Word in User Settings', fnWithTarget(addIgnoreWordToTarget, ConfigurationTarget.Global));
const actionAddWordToCSpell = prompt('Add Word to cSpell Configuration', fnWithTarget(addWordToTarget, TargetType.CSpell));
const actionAddWordToDictionary = prompt('Add Word to Dictionary', fnWithTarget(addWordToTarget, TargetType.Dictionary));

const commandHandlers: CommandHandler = {
    'cSpell.addWordToDictionarySilent': addWordToFolderDictionary,
    'cSpell.addWordToWorkspaceDictionarySilent': addWordToWorkspaceDictionary,
    'cSpell.addWordToUserDictionarySilent': addWordToUserDictionary,

    'cSpell.addWordToDictionary': actionAddWordToDictionary,
    'cSpell.addWordToFolderDictionary': actionAddWordToFolder,
    'cSpell.addWordToWorkspaceDictionary': actionAddWordToWorkspace,
    'cSpell.addWordToUserDictionary': actionAddWordToUser,

    'cSpell.removeWordFromFolderDictionary': actionRemoveWordFromFolderDictionary,
    'cSpell.removeWordFromWorkspaceDictionary': actionRemoveWordFromWorkspaceDictionary,
    'cSpell.removeWordFromUserDictionary': actionRemoveWordFromDictionary,

    'cSpell.addIgnoreWord': actionAddIgnoreWord,
    'cSpell.addIgnoreWordToFolder': actionAddIgnoreWordToFolder,
    'cSpell.addIgnoreWordToWorkspace': actionAddIgnoreWordToWorkspace,
    'cSpell.addIgnoreWordToUser': actionAddIgnoreWordToUser,

    'cSpell.enableLanguage': enableLanguageId,
    'cSpell.disableLanguage': disableLanguageId,
    'cSpell.enableForGlobal': () => setEnableSpellChecking(ConfigurationTarget.Global, true),
    'cSpell.disableForGlobal': () => setEnableSpellChecking(ConfigurationTarget.Global, false),
    'cSpell.toggleEnableForGlobal': () => toggleEnableSpellChecker(Settings.ConfigurationTarget.Global),
    'cSpell.enableForWorkspace': () => setEnableSpellChecking(ConfigurationTarget.Workspace, true),
    'cSpell.disableForWorkspace': () => setEnableSpellChecking(ConfigurationTarget.Workspace, false),
    'cSpell.toggleEnableSpellChecker': () => toggleEnableSpellChecker(Settings.ConfigurationTarget.Workspace),
    'cSpell.enableCurrentLanguage': enableCurrentLanguage,
    'cSpell.disableCurrentLanguage': disableCurrentLanguage,

    'cSpell.editText': handlerApplyTextEdits(),
    'cSpell.logPerfTimeline': dumpPerfTimeline,

    'cSpell.addWordToCSpellConfig': actionAddWordToCSpell,
    'cSpell.addIssuesToDictionary': notImplemented('cSpell.addIssuesToDictionary'),
    'cSpell.createCustomDictionary': notImplemented('cSpell.createCustomDictionary'),
    'cSpell.createCSpellConfig': createCSpellConfig,
};

function pVoid<T>(p: Promise<T> | Thenable<T>): Promise<void> {
    return Promise.resolve(p)
        .then(() => {})
        .catch((e) => window.showErrorMessage(e.toString()).then());
}

function notImplemented(cmd: string) {
    return () => pVoid(window.showErrorMessage(`Not yet implemented "${cmd}"`));
}

const propertyFixSpellingWithRenameProvider: SpellCheckerSettingsProperties = 'fixSpellingWithRenameProvider';

function handlerApplyTextEdits() {
    return async function applyTextEdits(uri: string, documentVersion: number, edits: TextEdit[]): Promise<void> {
        const client = di.get('client').client;
        const textEditor = window.activeTextEditor;
        if (!textEditor || textEditor.document.uri.toString() !== uri) return;

        if (textEditor.document.version !== documentVersion) {
            return pVoid(window.showInformationMessage('Spelling changes are outdated and cannot be applied to the document.'));
        }

        const cfg = workspace.getConfiguration(Settings.sectionCSpell, textEditor.document);
        if (cfg.get(propertyFixSpellingWithRenameProvider) && edits.length === 1) {
            console.log(`${propertyFixSpellingWithRenameProvider} Enabled`);
            const edit = edits[0];
            const range = client.protocol2CodeConverter.asRange(edit.range);
            if (await attemptRename(textEditor.document, range, edit.newText)) {
                return;
            }
        }

        return textEditor
            .edit((mutator) => {
                for (const edit of edits) {
                    mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
                }
            })
            .then((success) => (success ? undefined : pVoid(window.showErrorMessage('Failed to apply spelling changes to the document.'))));
    };
}

async function attemptRename(document: TextDocument, range: Range, text: string): Promise<boolean> {
    if (range.start.line !== range.end.line) {
        return false;
    }
    const wordRange = document.getWordRangeAtPosition(range.start);
    if (!wordRange || !wordRange.contains(range)) {
        return false;
    }
    const orig = wordRange.start.character;
    const a = range.start.character - orig;
    const b = range.end.character - orig;
    const docText = document.getText(wordRange);
    const newText = [docText.slice(0, a), text, docText.slice(b)].join('');
    try {
        const workspaceEdit = await commands
            .executeCommand('vscode.executeDocumentRenameProvider', document.uri, range.start, newText)
            .then(
                (a) => a as WorkspaceEdit | undefined,
                (reason) => (console.log(reason), false)
            );
        return !!workspaceEdit && workspaceEdit.size > 0 && (await workspace.applyEdit(workspaceEdit));
    } catch (e) {
        return false;
    }
}

function registerCmd(cmd: string, fn: (...args: any[]) => any): Disposable {
    return commands.registerCommand(cmd, catchErrors(fn));
}

export function registerCommands(): Disposable[] {
    const registeredHandlers = Object.entries(commandHandlers).map(([cmd, fn]) => registerCmd(cmd, fn));
    const registeredFromServer = Object.entries(commandsFromServer).map(([cmd, fn]) => registerCmd(cmd, fn));
    return [...registeredHandlers, ...registeredFromServer];
}

function addWordToFolderDictionary(word: string, docUri: string | null | Uri | undefined): Promise<void> {
    return addWordToTarget(word, ConfigurationTarget.WorkspaceFolder, docUri);
}

export function addWordToWorkspaceDictionary(word: string, docUri: string | null | Uri | undefined): Promise<void> {
    // eslint-disable-next-line prefer-rest-params
    console.log('addWordToWorkspaceDictionary %o', arguments);
    return addWordToTarget(word, ConfigurationTarget.Workspace, docUri);
}

export function addWordToUserDictionary(word: string): Promise<void> {
    return addWordToTarget(word, ConfigurationTarget.Global, undefined);
}

function addWordToTarget(word: string, target: AllTargetTypes, docUri: string | null | Uri | undefined) {
    return handleErrors(_addWordToTarget(word, target, docUri));
}

function _addWordToTarget(word: string, target: AllTargetTypes, docUri: string | null | Uri | undefined) {
    docUri = parseOptionalUri(docUri);
    return di.get('dictionaryHelper').addWordsToTarget(word, target, docUri);
}

function addIgnoreWordToTarget(word: string, target: ConfigurationTarget, uri: string | null | Uri | undefined): Promise<void> {
    return handleErrors(_addIgnoreWordToTarget(word, target, uri));
}

async function _addIgnoreWordToTarget(word: string, target: ConfigurationTarget, uri: string | null | Uri | undefined): Promise<void> {
    uri = parseOptionalUri(uri);
    const actualTarget = resolveTarget(target, uri);
    await Settings.addIgnoreWordToSettings(actualTarget, word);
    const paths = await determineSettingsPaths(actualTarget, uri);
    await Promise.all(paths.map((path) => CSpellSettings.addIgnoreWordToSettingsAndUpdate(path, word)));
}

function removeWordFromFolderDictionary(word: string, uri: string | null | Uri | undefined): Promise<void> {
    return removeWordFromTarget(word, ConfigurationTarget.WorkspaceFolder, uri);
}

function removeWordFromWorkspaceDictionary(word: string, uri: string | null | Uri | undefined): Promise<void> {
    return removeWordFromTarget(word, ConfigurationTarget.Workspace, uri);
}

function removeWordFromUserDictionary(word: string): Promise<void> {
    return removeWordFromTarget(word, ConfigurationTarget.Global, undefined);
}

function removeWordFromTarget(word: string, target: ConfigurationTarget, uri: string | null | Uri | undefined) {
    return handleErrors(_removeWordFromTarget(word, target, uri));
}

async function _removeWordFromTarget(word: string, target: ConfigurationTarget, uri: string | null | Uri | undefined) {
    uri = parseOptionalUri(uri);
    const actualTarget = resolveTarget(target, uri);
    await Settings.removeWordFromSettings(actualTarget, word);
    const paths = await determineSettingsPaths(actualTarget, uri);
    await Promise.all(paths.map((path) => CSpellSettings.removeWordFromSettingsAndUpdate(path, word)));
}

export function enableLanguageId(languageId: string, uri?: string | Uri): Promise<void> {
    uri = parseOptionalUri(uri);
    return handleErrors(Settings.enableLanguageIdForClosestTarget(languageId, true, uri));
}

export function disableLanguageId(languageId: string, uri?: string | Uri): Promise<void> {
    uri = parseOptionalUri(uri);
    return handleErrors(Settings.enableLanguageIdForClosestTarget(languageId, false, uri));
}

function onCommandUseDiagsSelectionOrPrompt(
    prompt: string,
    fnAction: (text: string, uri: Uri | undefined) => Promise<void>
): () => Promise<void> {
    return function () {
        const document = window.activeTextEditor?.document;
        const selection = window.activeTextEditor?.selection;
        const range = selection && document?.getWordRangeAtPosition(selection.active);
        const diags = document ? getCSpellDiags(document.uri) : undefined;
        const value = extractMatchingDiagText(document, selection, diags) || (range && document?.getText(range));
        const r = value
            ? fnAction(value, document?.uri)
            : window.showInputBox({ prompt, value }).then((word) => {
                  word && fnAction(word, document && document.uri);
              });
        return Promise.resolve(r);
    };
}

function dumpPerfTimeline(): void {
    performance.getEntries().forEach((entry) => {
        console.log(entry.name, toMilliseconds(entry.startTime), entry.duration);
    });
}

function extractMatchingDiagText(
    doc: TextDocument | undefined,
    selection: Selection | undefined,
    diags: Diagnostic[] | undefined
): string | undefined {
    if (!doc || !selection || !diags) return undefined;
    return extractMatchingDiagTexts(doc, selection, diags)?.join(' ');
}

function extractMatchingDiagTexts(
    doc: TextDocument | undefined,
    selection: Selection | undefined,
    diags: Diagnostic[] | undefined
): string[] | undefined {
    if (!doc || !diags) return undefined;
    const selText = selection && doc.getText(selection);
    const matching = diags
        .map((d) => d.range)
        .map((r) => determineWordToAddToDictionaryFromSelection(doc, selText, selection, r))
        .filter(isDefined);
    return matching;
}

/**
 * An expression that matches most word like constructions. It just needs to be close.
 * If it doesn't match, the idea is to fall back to the diagnostic selection.
 */
const regExpIsWordLike = /^[\p{L}\w.-]+$/u;

function determineWordToAddToDictionaryFromSelection(
    doc: TextDocument,
    selectedText: string | undefined,
    selection: Selection | undefined,
    diagRange: Range
): string | undefined {
    if (!selection || !selectedText || diagRange.contains(selection)) return doc.getText(diagRange);

    const intersect = selection.intersection(diagRange);
    if (!intersect || intersect.isEmpty) return undefined;

    // The selection is bigger than the diagRange. Did the person intend for the entire selection to
    // be included or just the diag. If the selected text is a word, then assume the entire selection
    // was wanted, otherwise use the diag range.

    return regExpIsWordLike.test(selectedText) ? selectedText : doc.getText(diagRange);
}

function toDictionaryTarget(targetType: TargetType.User, docUri?: string | Uri): DictionaryTargetUser;
function toDictionaryTarget(targetType: TargetType.Workspace, docUri?: string | Uri): DictionaryTargetWorkspace;
function toDictionaryTarget(targetType: TargetType.Folder, docUri: string | Uri): DictionaryTargetFolder;
function toDictionaryTarget(
    targetType: TargetType.User | TargetType.Workspace,
    docUri?: string | Uri
): DictionaryTargetUser | DictionaryTargetWorkspace;
function toDictionaryTarget(
    targetType: TargetType.User | TargetType.Workspace | TargetType.Folder,
    docUri: string | Uri
): DictionaryTargetUser | DictionaryTargetWorkspace | DictionaryTargetFolder;
function toDictionaryTarget(
    targetType: TargetType.CSpell | TargetType.Dictionary,
    docUri: string | Uri,
    name: string,
    uri: string | Uri
): DictionaryTargetCSpellConfig | DictionaryTargetDictionary;
function toDictionaryTarget(
    targetType: DictionaryTargetTypes,
    docUri?: string | Uri,
    name?: string,
    uri?: string | Uri
): DictionaryTargets {
    switch (targetType) {
        case TargetType.User:
            return { type: targetType, docUri: toMaybeUri(docUri) };
        case TargetType.Workspace:
            return { type: targetType, docUri: toMaybeUri(docUri) };
        case TargetType.Folder:
            return { type: targetType, docUri: toUri(mustBeDefined(docUri)) };
        case TargetType.CSpell:
            return { type: targetType, docUri: toMaybeUri(docUri), name: mustBeDefined(name), uri: toUri(mustBeDefined(uri)) };
        case TargetType.Dictionary:
            return { type: targetType, docUri: toMaybeUri(docUri), name: mustBeDefined(name), uri: toUri(mustBeDefined(uri)) };
    }
    throw new Error(`Unknown target type ${targetType}`);
}

function toMaybeUri(uri: string | Uri | undefined): Uri | undefined {
    if (!uri) return undefined;
    return toUri(uri);
}

function mustBeDefined<T>(t: T | undefined): T {
    if (t === undefined || t === null) throw new Error('Value must be defined.');
    return t;
}

function parseOptionalUri(uri: string | Uri): Uri;
function parseOptionalUri(uri: null | undefined): Uri | undefined;
function parseOptionalUri(uri: string | Uri | null | undefined): Uri | undefined;
function parseOptionalUri(uri: string | Uri | null | undefined): Uri | undefined {
    if (typeof uri === 'string') {
        return Uri.parse(uri);
    }
    return uri || undefined;
}

function fnWithTarget<TT>(
    fn: (word: string, t: TT, uri: Uri | undefined) => Promise<void>,
    t: TT
): (word: string, uri: Uri | undefined) => Promise<void> {
    return (word, uri) => fn(word, t, uri);
}

function createCSpellConfig(): Promise<void> {
    return pVoid(createConfigFileRelativeToDocumentUri(window.activeTextEditor?.document.uri));
}

export const __testing__ = {
    determineWordToAddToDictionaryFromSelection,
    extractMatchingDiagText,
    extractMatchingDiagTexts,
    commandHandlers,
};
