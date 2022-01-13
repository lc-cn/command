import {Command} from "@/command";
export interface Token {
    rest?: string
    content: string
    quoted: boolean
    terminator: string
    inters: Argv[]
}

const leftQuotes = `"'“‘`
const rightQuotes = `"'”’`
export interface Argv<A extends any[] = any[], O = {}> {
    args?: A
    options?: O
    error?: string
    source?: string
    initiator?: string
    terminator?: string
    command?: Command<A, O>
    rest?: string
    pos?: number
    root?: boolean
    tokens?: Token[]
    name?: string
}
export namespace Argv{
    export interface Interpolation {
        terminator?: string
        parse?(source: string): Argv
    }
    const bracs: Record<string, Interpolation> = {}
    export function interpolate(initiator: string, terminator: string, parse?: (source: string) => Argv) {
        bracs[initiator] = { terminator, parse }
    }
    interpolate('$(', ')')
    export function escapeRegExp(source: string) {
        return source
            .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
            .replace(/-/g, '\\x2d')
    }
    export class Tokenizer {
        private readonly bracs: Record<string, Interpolation>

        constructor() {
            this.bracs = Object.create(bracs)
        }

        interpolate(initiator: string, terminator: string, parse?: (source: string) => Argv) {
            this.bracs[initiator] = { terminator, parse }
        }

        parseToken(source: string, stopReg = '$'): Token {
            const parent = { inters: [] } as Token
            const index = leftQuotes.indexOf(source[0])
            const quote = rightQuotes[index]
            let content = ''
            if (quote) {
                source = source.slice(1)
                stopReg = `${quote}(?=${stopReg})|$`
            }
            stopReg += `|${Object.keys({ ...this.bracs, ...bracs }).map(escapeRegExp).join('|')}`
            const regExp = new RegExp(stopReg)
            while (true) {
                const capture = regExp.exec(source)
                content += source.slice(0, capture.index)
                if (capture[0] in this.bracs) {
                    source = source.slice(capture.index + capture[0].length).trimStart()
                    const { parse, terminator } = this.bracs[capture[0]]
                    const argv = parse?.(source) || this.parse(source, terminator)
                    source = argv.rest
                    parent.inters.push({ ...argv, pos: content.length, initiator: capture[0] })
                } else {
                    const quoted = capture[0] === quote
                    const rest = source.slice(capture.index + +quoted)
                    parent.rest = rest.trimStart()
                    parent.quoted = quoted
                    parent.terminator = capture[0]
                    if (quoted) {
                        parent.terminator += rest.slice(0, -parent.rest.length)
                    } else if (quote) {
                        content = leftQuotes[index] + content
                        parent.inters.forEach(inter => inter.pos += 1)
                    }
                    parent.content = content
                    if (quote === "'") Argv.revert(parent)
                    return parent
                }
            }
        }

        parse(source: string, terminator = ''): Argv {
            const tokens: Token[] = []
            let rest = source, term = ''
            const stopReg = `\\s+|[${escapeRegExp(terminator)}]|$`
            // eslint-disable-next-line no-unmodified-loop-condition
            while (rest && !(terminator && rest.startsWith(terminator))) {
                const token = this.parseToken(rest, stopReg)
                tokens.push(token)
                rest = token.rest
                term = token.terminator
                delete token.rest
            }
            if (rest.startsWith(terminator)) rest = rest.slice(1)
            source = source.slice(0, -(rest + term).length)
            return { tokens, rest, source }
        }

        stringify(argv: Argv) {
            const output = argv.tokens.reduce((prev, token) => {
                if (token.quoted) prev += leftQuotes[rightQuotes.indexOf(token.terminator[0])]
                return prev + token.content + token.terminator
            }, '')
            if (argv.rest && !rightQuotes.includes(output[output.length - 1]) || argv.initiator) {
                return output.slice(0, -1)
            }
            return output
        }
    }
    const defaultTokenizer = new Tokenizer()
    export function parse(source: string, terminator = '') {
        return defaultTokenizer.parse(source, terminator)
    }

    export function stringify(argv: Argv) {
        return defaultTokenizer.stringify(argv)
    }

    export function revert(token: Token) {
        while (token.inters.length) {
            const { pos, source, initiator } = token.inters.pop()
            token.content = token.content.slice(0, pos)
                + initiator + source + bracs[initiator].terminator
                + token.content.slice(pos)
        }
    }
    export interface Domain {
        string: string
        number: number
        boolean: boolean
        text: string
        rawtext: string
        user: string
        channel: string
        integer: number
        posint: number
        natural: number
        date: Date
    }
    type DomainType = keyof Domain

    type ParamType<S extends string, F>
        = S extends `${any}:${infer T}` ? T extends DomainType ? Domain[T] : F : F

    type Replace<S extends string, X extends string, Y extends string>
        = S extends `${infer L}${X}${infer R}` ? `${L}${Y}${Replace<R, X, Y>}` : S

    type ExtractAll<S extends string, F>
        = S extends `${infer L}]${infer R}` ? [ParamType<L, F>, ...ExtractAll<R, F>] : []

    type ExtractFirst<S extends string, F>
        = S extends `${infer L}]${any}` ? ParamType<L, F> : boolean

    type ExtractSpread<S extends string> = S extends `${infer L}...${infer R}`
        ? [...ExtractAll<L, string>, ...ExtractFirst<R, string>[]]
        : [...ExtractAll<S, string>, ...string[]]

    export type ArgumentType<S extends string> = ExtractSpread<Replace<S, '>', ']'>>

    export type OptionType<S extends string> = ExtractFirst<Replace<S, '>', ']'>, any>

    export type Type = DomainType | RegExp | string[] | Transform<any>

    export interface Declaration {
        name?: string
        type?: Type
        fallback?: any
        variadic?: boolean
        required?: boolean
    }

    export type Transform<T> = (source: string) => T

    export interface DomainConfig<T> {
        transform?: Transform<T>
        greedy?: boolean
    }
    export function resolveConfig(type: Type) {
        return typeof type === 'string' ? builtin[type] || {} : {}
    }

    function resolveType(type: Type) {
        if (typeof type === 'function') {
            return type
        } else if (type instanceof RegExp) {
            return (source: string) => {
                if (type.test(source)) return source
                throw new Error()
            }
        } else if (Array.isArray(type)) {
            return (source: string) => {
                if (type.includes(source)) return source
                throw new Error()
            }
        }
        return builtin[type]?.transform
    }

    const builtin: Record<string, DomainConfig<any>> = {}

    export function createDomain<K extends keyof Domain>(name: K, transform: Transform<Domain[K]>, options?: DomainConfig<Domain[K]>) {
        builtin[name] = { ...options, transform }
    }

    createDomain('rawtext', source => source)
    createDomain('string', source => source)
    createDomain('text', source => source, { greedy: true })
    createDomain('rawtext', source => String(source)
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&#44;/g, ',')
        .replace(/&amp;/g, '&'), { greedy: true })
    createDomain('boolean', () => true)

    createDomain('number', (source) => {
        const value = +source
        if (Number.isFinite(value)) return value
        throw new Error('invalid-number')
    })

    createDomain('integer', (source) => {
        const value = +source
        if (value * 0 === 0 && Math.floor(value) === value) return value
        throw new Error('invalid-integer')
    })

    createDomain('posint', (source) => {
        const value = +source
        if (value * 0 === 0 && Math.floor(value) === value && value > 0) return value
        throw new Error('invalid-posint')
    })

    createDomain('natural', (source) => {
        const value = +source
        if (value * 0 === 0 && Math.floor(value) === value && value >= 0) return value
        throw new Error('invalid-natural')
    })

    createDomain('date', (source) => {
        const timestamp = new Date(source)
        if (+timestamp) return timestamp
        throw new Error('invalid-date')
    })


    const BRACKET_REGEXP = /<[^>]+>|\[[^\]]+\]/g

    interface DeclarationList extends Array<Declaration> {
        stripped: string
    }

    export function parseDecl(source: string) {
        let cap: RegExpExecArray
        const result = [] as DeclarationList
        // eslint-disable-next-line no-cond-assign
        while (cap = BRACKET_REGEXP.exec(source)) {
            let rawName = cap[0].slice(1, -1)
            let variadic = false
            if (rawName.startsWith('...')) {
                rawName = rawName.slice(3)
                variadic = true
            }
            const [name, rawType] = rawName.split(':')
            const type = rawType ? rawType.trim() as DomainType : undefined
            result.push({
                name,
                variadic,
                type,
                required: cap[0][0] === '<',
            })
        }
        result.stripped = source.replace(/:[\w-]+[>\]]/g, str => str.slice(-1)).trimEnd()
        return result
    }

    export function parseValue(source: string, quoted: boolean, kind: string, argv: Argv, decl: Declaration = {}) {
        const { name, type, fallback } = decl

        // no explicit parameter & has fallback
        const implicit = source === '' && !quoted
        if (implicit && fallback !== undefined) return fallback

        // apply domain callback
        const transform = resolveType(type)
        if (transform) {
            try {
                return transform(source)
            } catch (err) {
                const message = err['message'] || 'check-syntax'
                argv.error = `invalid-${kind}.(${name}):${message}(${source})`
                    .replace(/invalid-/g,'无效的')
                    .replace('argument.','参数')
                    .replace('option.','选项')
                return
            }
        }

        // default behavior
        if (implicit) return true
        if (quoted) return source
        const n = +source
        return n * 0 === 0 ? n : source
    }

    export interface OptionConfig<T extends Type = Type> {
        value?: any
        fallback?: any
        type?: T
        /** hide the option by default */
        hidden?: boolean
        authority?: number
        notUsage?: boolean
    }

    export interface TypedOptionConfig<T extends Type> extends OptionConfig<T> {
        type: T
    }

    export interface OptionDeclaration extends Declaration, OptionConfig {
        description?: string
        values?: Record<string, any>
    }

    export type OptionDeclarationMap = Record<string, OptionDeclaration>
}