import type * as config from './config/cspellConfig';

export type {
    LanguageSetting,
    DictionaryDefinition,
    DictionaryFileTypes,
    CustomDictionaryScope,
    DictionaryDefinitionCustom,
    SpellCheckerSettings,
    CustomDictionaryEntry,
    CustomDictionaryWithScope,
    CSpellUserSettingsWithComments,
    CSpellUserSettings,
    SpellCheckerSettingsProperties,
} from './config/cspellConfig';

/**
 * Method signatures for requests to the Server.
 */
export type ServerRequestApi = {
    [key in keyof ServerMethods]: ApiReqResFn<ServerMethods[key]>;
};

/**
 * Internal Server Handler signatures to the Server API
 */
export type ServerRequestApiHandlers = ApiHandlers<ServerMethods>;

/**
 * Server RPC Request and Result types
 */
export type ServerMethods = {
    getConfigurationForDocument: ReqRes<TextDocumentInfo, GetConfigurationForDocumentResult>;
    isSpellCheckEnabled: ReqRes<TextDocumentInfo, IsSpellCheckEnabledResult>;
    splitTextIntoWords: ReqRes<string, SplitTextIntoWordsResult>;
    spellingSuggestions: ReqRes<TextDocumentInfo, SpellingSuggestionsResult>;
    matchPatternsInDocument: ReqRes<MatchPatternsToDocumentRequest, MatchPatternsToDocumentResult>;
};

/**
 * One way RPC calls to the server
 */
export type ServerNotifyApi = {
    notifyConfigChange: () => void;
    registerConfigurationFile: (path: string) => void;
};

/**
 * Notification that can be sent to the client
 */
export type ClientNotifications = {
    onSpellCheckDocument: OnSpellCheckDocumentStep;
};

/**
 * Client side API for listening to notifications from the server
 */
export type ClientNotificationsApi = {
    [method in keyof ClientNotifications]: (p: ClientNotifications[method]) => void;
};

/**
 * Internal - API for sending notifications to the client
 */
export type SendClientNotificationsApi = {
    [method in keyof ClientNotifications as `send${Capitalize<method>}`]: (p: ClientNotifications[method]) => void;
};

/**
 * Requests that can be made of the client
 */
export type RequestsToClient = {
    onWorkspaceConfigForDocumentRequest: ReqRes<WorkspaceConfigForDocumentRequest, WorkspaceConfigForDocumentResponse>;
};

/**
 * Internal - API for sending requests to the client
 */
export type SendRequestsToClientApi = {
    [method in keyof RequestsToClient as `send${Capitalize<method>}`]: ApiReqResFn<RequestsToClient[method]>;
};

export type ClientSideCommandHandlerApi = {
    [command in keyof CommandsToClient as `cSpell.${command}`]: (...params: Parameters<CommandsToClient[command]>) => OrPromise<void>;
};
export interface CommandsToClient {
    addWordsToVSCodeSettings: (words: string[], documentUri: string, target: 'user' | 'workspace' | 'folder') => void;
    addWordsToDictionaryFile: (words: string[], documentUri: string, dict: { uri: string; name: string }) => void;
    addWordsToConfigFile: (words: string[], documentUri: string, config: { uri: string; name: string }) => void;
}

export type RequestsToClientApiHandlers = ApiHandlers<RequestsToClient>;

export interface GetConfigurationForDocumentResult {
    languageEnabled: boolean | undefined;
    fileEnabled: boolean | undefined;
    settings: config.CSpellUserSettings | undefined;
    docSettings: config.CSpellUserSettings | undefined;
    excludedBy: ExcludeRef[] | undefined;
    configFiles: UriString[];
}

export interface ExcludeRef {
    glob: string;
    id: string | undefined;
    name: string | undefined;
    filename: string | undefined;
}

export interface IsSpellCheckEnabledResult {
    languageEnabled: boolean | undefined;
    fileEnabled: boolean | undefined;
    excludedBy: ExcludeRef[] | undefined;
}

export interface SplitTextIntoWordsResult {
    words: string[];
}

export interface SpellingSuggestionsResult {}

export interface TextDocumentInfo {
    uri?: UriString;
    languageId?: string;
    text?: string;
}

export type ServerRequestMethods = keyof ServerMethods;

export type ServerRequestMethodConstants = {
    [key in ServerRequestMethods]: key;
};

export type NotifyServerMethods = keyof ServerNotifyApi;
export type NotifyServerMethodConstants = {
    [key in NotifyServerMethods]: NotifyServerMethods;
};

export interface TextDocumentRef {
    uri: UriString;
}

export interface NamedPattern {
    name: string;
    pattern: string | string[];
}

export interface MatchPatternsToDocumentRequest extends TextDocumentRef {
    patterns: (string | NamedPattern)[];
}

export type StartIndex = number;
export type EndIndex = number;

export type RangeTuple = [StartIndex, EndIndex];

export interface RegExpMatch {
    regexp: string;
    matches: RangeTuple[];
    elapsedTime: number;
    errorMessage?: string;
}

export type RegExpMatchResults = RegExpMatch;

export interface PatternMatch {
    name: string;
    defs: RegExpMatch[];
}

export interface MatchPatternsToDocumentResult {
    uri: UriString;
    version: number;
    patternMatches: PatternMatch[];
    message?: string;
}

export interface OnSpellCheckDocumentStep extends NotificationInfo {
    /**
     * uri of the text document
     */
    uri: DocumentUri;

    /**
     *
     */
    version: number;

    /**
     * name of step.
     */
    step: string;

    /**
     * Number of issues found
     */
    numIssues?: number;

    /**
     * true if it is finished
     */
    done?: boolean;
}

export interface NotificationInfo {
    /**
     * Sequence number.
     * Notifications can be sorted based upon the sequence number to give the order
     * in which the Notification was generated.
     * It should be unique between Notifications of the same type.
     */
    seq: number;

    /**
     * timestamp in ms.
     */
    ts: number;
}

export interface WorkspaceConfigForDocumentRequest {
    uri: DocumentUri;
}

export interface WorkspaceConfigForDocumentResponse {
    uri: DocumentUri;
    workspaceFile: UriString | undefined;
    workspaceFolder: UriString | undefined;
    words: ConfigurationTargets;
    ignoreWords: ConfigurationTargets;
}

export interface ConfigurationTargets {
    user?: boolean;
    workspace?: boolean;
    folder?: boolean;
}

export type UriString = string;
export type DocumentUri = UriString;

export type Req<T> = T extends { request: infer R } ? R : never;
export type Res<T> = T extends { response: infer R } ? R : never;
export type Fn<T> = T extends { fn: infer R } ? R : never;
export type OrPromise<T> = Promise<T> | T;

export type ReqRes<Req, Res> = {
    request: Req;
    response: Res;
};

/**
 * Utility type to combine the Request and Response to create the Handler function
 */
export type RequestResponseFn<ReqRes> = {
    request: Req<ReqRes>;
    response: Res<ReqRes>;
    fn: ApiReqHandler<ReqRes>;
};

export type ApiReqResFn<ReqRes> = ApiFn<Req<ReqRes>, Res<ReqRes>>;
export type ApiFn<Req, Res> = (req: Req) => Promise<Res>;

export type ApiReqHandler<ReqRes> = ApiHandler<Req<ReqRes>, Res<ReqRes>>;
export type ApiHandler<Req, Res> = (req: Req) => OrPromise<Res>;

export type ApiHandlers<ApiReqRes> = {
    [M in keyof ApiReqRes]: ApiReqHandler<ApiReqRes[M]>;
};

export type ApiReqResMethods<ApiReqRes> = {
    [M in keyof ApiReqRes]: ApiReqResFn<ApiReqRes[M]>;
};
