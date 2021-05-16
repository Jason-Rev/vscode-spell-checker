/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { getDocUri, activateExtension, loadDocument, sleep, log, chalk } from './helper';
import { expect } from 'chai';
import { ExtensionApi } from './ExtensionApi';
import * as vscode from 'vscode';

type Api = {
    [K in keyof ExtensionApi]: K;
};

const apiSignature: Api = {
    addWordToUserDictionary: 'addWordToUserDictionary',
    addWordToWorkspaceDictionary: 'addWordToWorkspaceDictionary',
    disableCurrentLanguage: 'disableCurrentLanguage',
    disableLanguageId: 'disableLanguageId',
    disableLocale: 'disableLocale',
    enableCurrentLanguage: 'enableCurrentLanguage',
    enableLanguageId: 'enableLanguageId',
    enableLocale: 'enableLocale',
    registerConfig: 'registerConfig',
    triggerGetSettings: 'triggerGetSettings',
    updateSettings: 'updateSettings',
    cSpellClient: 'cSpellClient',
};

describe('Launch code spell extension', function () {
    this.timeout(120000);
    const docUri = getDocUri('diagnostics.txt');

    it('Verify the extension starts', async () => {
        log(chalk.yellow('Verify the extension starts'));
        const extContext = await activateExtension();
        const docContext = await loadDocument(docUri);
        expect(extContext).to.not.be.undefined;
        expect(docContext).to.not.be.undefined;
        const extApi = extContext!.extApi;
        expect(extApi).to.not.be.undefined;
        expect(extApi).to.equal(extContext?.extActivate);
        expect(extApi).haveOwnProperty(apiSignature.addWordToUserDictionary);
        expect(extApi).to.include.all.keys(...Object.keys(apiSignature));
        log(chalk.yellow('Done: Verify the extension starts'));
    });

    it('Verifies that the right config was found', async () => {
        log(chalk.yellow('Verifies that the right config was found'));
        const ext = isDefined(await activateExtension());
        const uri = getDocUri('example.md');
        const expectedConfigUri = getDocUri('cspell.json');
        const diagsListener = waitForDiag(uri);
        const folders = vscode.workspace.workspaceFolders;
        log(
            `Workspace Folders:
        %O
        `,
            folders
        );
        try {
            const docContextMaybe = await loadDocument(uri);
            expect(docContextMaybe).to.not.be.undefined;
            const docContext = isDefined(docContextMaybe);

            const config = await ext.extApi.cSpellClient().getConfigurationForDocument(docContext.doc);

            const { excludedBy, fileEnabled, configFiles } = config;
            log('config: %o', { excludedBy, fileEnabled, configFiles });

            const configUri = vscode.Uri.parse(config.configFiles[0] || '');
            expect(configUri.toString()).to.equal(expectedConfigUri.toString());
        } finally {
            diagsListener.dispose();
        }
        log(chalk.yellow('Done: Verifies that the right config was found'));
    });

    it('Verifies that some spelling errors were found', async () => {
        log(chalk.yellow('Verifies that some spelling errors were found'));
        const ext = isDefined(await activateExtension());
        const uri = getDocUri('example.md');
        const diagsListener = waitForDiag(uri);
        try {
            const docContextMaybe = await loadDocument(uri);
            expect(docContextMaybe).to.not.be.undefined;
            const docContext = isDefined(docContextMaybe);

            const config = await ext.extApi.cSpellClient().getConfigurationForDocument(docContext.doc);

            const { excludedBy, fileEnabled } = config;
            log('config: %O', { excludedBy, fileEnabled });

            const cfg = config.docSettings || config.settings;
            const { enabled, dictionaries, languageId } = cfg || {};

            log('cfg: %O', { enabled, dictionaries, languageId });

            const diags = await Promise.race([diagsListener.diags, sleep(120000)]);
            await sleep(3000);
            const msgs = diags ? diags.map((a) => `C: ${a.source} M: ${a.message}`).join('\n') : 'Timeout';
            log(`Diag Messages: size(${diags?.length}) msg: \n${msgs}`);
            log('diags: \n%o', diags || 'No diags registered');

            expect(fileEnabled).to.be.true;

            // cspell:ignore spellling
            expect(msgs).contains('spellling');
        } finally {
            diagsListener.dispose();
        }
        log(chalk.yellow('Done: Verifies that some spelling errors were found'));
    });

    function waitForDiag(uri: vscode.Uri) {
        type R = vscode.Diagnostic[];
        const diags: R = [];
        const source = 'cSpell';
        const uriStr = uri.toString();
        let dispose: vscode.Disposable | undefined;
        let resolved = false;

        function cleanUp() {
            dispose?.dispose();
            dispose = undefined;
        }
        return {
            diags: new Promise<R>((resolve) => {
                dispose = vscode.languages.onDidChangeDiagnostics((event) => {
                    log('onDidChangeDiagnostics %o', event);
                    const matches = event.uris.map((u) => u.toString()).filter((u) => u === uriStr);
                    if (matches.length) {
                        const matchingDiags = vscode.languages.getDiagnostics(uri).filter((diag) => diag.source === source);
                        log('Diags: %o', matchingDiags);
                        matchingDiags.forEach((diag) => diags.push(diag));
                        if (!resolved) {
                            resolved = true;
                            resolve(diags);
                        }
                    }
                });
            }),
            dispose: cleanUp,
        };
    }
});

function isDefined<T>(t: T | undefined): T {
    if (t === undefined) {
        throw new Error('undefined');
    }
    return t;
}
