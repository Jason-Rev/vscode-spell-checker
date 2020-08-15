// import { TextDocument } from 'vscode-languageserver-textdocument';
import { CSpellUserSettings } from './cspellConfig';
import { RegExpWorker, TimeoutError } from 'regexp-worker';
import { measurePromiseExecution } from './timer';

export interface Pattern {
    name: string;
    regexp: RegExp;
}

export type Range = [number, number];

export interface PatternMatch {
    name: string;
    regexp: RegExp;
    elapsedTimeMs: number;
    ranges: Range[];
}

export interface PatternMatchTimeout {
    name: string;
    regexp: RegExp;
    elapsedTimeMs: number;
    message: string;
}

export type MatchResult = PatternMatch | PatternMatchTimeout;
export type MatchResults = MatchResult[];

export type PatternSettings = {
    patterns: CSpellUserSettings['patterns'];
}

export class PatternMatcher {
    private worker: RegExpWorker = new RegExpWorker(2000);
    public dispose = () => this.worker.dispose();

    async matchPatternsInText(patterns: string[], text: string, settings: PatternSettings): Promise<MatchResults> {
        const resolvedPatterns = resolvePatterns(patterns, settings);

        // Optimistically expect them all to work.
        try {
            const result = await measurePromiseExecution(() => matchMatrix(this.worker, text, resolvedPatterns));
            return result.r;
        } catch (e) {
            if (!isTimeoutError(e)) {
                return Promise.reject(e);
            }
        }

        // At least one of the expressions failed to complete in time.
        // Process them one-by-one
        const results = resolvedPatterns.map(pat => exec(this.worker, text, pat))
        return Promise.all(results);
    }
}

export function isPatternMatch(m: MatchResult): m is PatternMatch {
    return Array.isArray((m as PatternMatch).ranges);
}

export function isPatternMatchTimeout(m: MatchResult): m is PatternMatchTimeout {
    return !isPatternMatch(m);
}

function matchMatrix(worker: RegExpWorker, text: string, patterns: Pattern[]): Promise<PatternMatch[]> {
    const regexArray = patterns.map(pat => pat.regexp);
    const result = worker.matchRegExpArray(text, regexArray)
    .then(r => {
        return r.results.map((result, index) => toPatternMatch(patterns[index], result))
    })
    return result;
}

function exec(worker: RegExpWorker, text: string, pattern: Pattern): Promise<MatchResult> {
    return worker.matchRegExp(text, pattern.regexp)
    .then(r => toPatternMatch(pattern, r))
    .catch(e => toPatternMatchTimeout(pattern, e))
}

function toPatternMatchTimeout(pattern: Pattern, error: any | TimeoutError): PatternMatchTimeout | Promise<PatternMatchTimeout> {
    if (!isTimeoutError(error)) return Promise.reject(error);
    return {
        ...error,
        ...pattern,
    };
}

function isTimeoutError(e: any | TimeoutError): e is TimeoutError {
    return typeof e === 'object'
    && typeof e.message === 'string'
    && typeof e.elapsedTimeMs === 'number'
}

interface MatchRegExpResult {
    readonly elapsedTimeMs: number;
    readonly ranges: IterableIterator<Range>
}

function toPatternMatch(pattern: Pattern, result: MatchRegExpResult): PatternMatch {
    return {
        ...pattern,
        elapsedTimeMs: result.elapsedTimeMs,
        ranges: [...result.ranges],
    }
}

function resolvePatterns(patterns: string[], settings: PatternSettings): Pattern[] {
    const knownPatterns = extractPatternsFromSettings(settings)
    const matchingPatterns = patterns
        .map(pat => knownPatterns.get(pat.toLowerCase()) || ({ name: pat, regexp: toRegExp(pat, 'g')}))
    return matchingPatterns;
}

function extractPatternsFromSettings(settings: PatternSettings): Map<string, Pattern> {
    const knownPatterns = settings.patterns
        ?.map(({name, pattern}) => ({ name, regexp: toRegExp(pattern) }))
        .map(pat => [pat.name.toLowerCase(), pat] as [string, Pattern])
    return new Map(knownPatterns || []);
}

export function toRegExp(r: RegExp | string, defaultFlags?: string): RegExp {
    if (isRegExp(r)) return r;

    const match = r.match(/^\/(.*)\/([gimsuy]*)$/);
    if (match) {
        return new RegExp(match[1], match[2] || defaultFlags);
    }
    return new RegExp(r, defaultFlags);
}

export function isRegExp(r: RegExp | any): r is RegExp {
    return r instanceof RegExp;
}
