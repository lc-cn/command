import {Argv} from "@/argv";
import Declaration = Argv.Declaration;
import {format} from "util";

export type Extend<O extends {}, K extends string, T> = {
    [P in K | keyof O]?: (P extends keyof O ? O[P] : unknown) & (P extends K ? T : unknown)
}

export namespace Command {
    export interface Config {
        /** hide all options by default */
        hideOptions?: boolean
        /** hide command */
        hidden?: boolean
        /** min authority */
        authority?: number
        /** disallow unknown options */
        checkUnknown?: boolean
        /** check argument count */
        checkArgCount?: boolean
        /** show command warnings */
        showWarning?: boolean
        /** usage identifier */
        usageName?: string
        maxUsage?: number
        /** min interval */
        minInterval?: number
        /** depend on existing commands */
        patch?: boolean
    }

    export interface Shortcut {
        name?: string | RegExp
        command?: Command
        authority?: number
        prefix?: boolean
        fuzzy?: boolean
        args?: string[]
        options?: Record<string, any>
    }

    export type Action< A extends any[] = any[], O extends {} = {}>
        = (argv: Argv<A, O>, ...args: A) => any|Promise<any>
}
export class Command<A extends any[]=any[],O extends {}={}>{
    public declaration: string
    config: Command.Config
    _examples: string[] = []
    _aliases: string[] = []
    private _actions: Command.Action<A, O>[] = []
    private _checkers: Command.Action<A, O>[] = []
    public _arguments: Declaration[]
    public _options: Argv.OptionDeclarationMap = {}

    private _namedOptions: Argv.OptionDeclarationMap = {}
    private _symbolicOptions: Argv.OptionDeclarationMap = {}
    constructor(public name: string, declaration: string, public description: string) {
        if (!name) throw new Error('expect a command name')
        const decl = this._arguments = Argv.parseDecl(declaration)
        this.declaration = decl.stripped
        this._aliases.push(name)
    }
    option<K extends string>(name: K, desc: string, config: Argv.TypedOptionConfig<RegExp>): Command< A, Extend<O, K, string>>
    option<K extends string, R>(name: K, desc: string, config: Argv.TypedOptionConfig<(source: string) => R>): Command< A, Extend<O, K, R>>
    option<K extends string, R extends string>(name: K, desc: string, config: Argv.TypedOptionConfig<R[]>): Command<A, Extend<O, K, R>>
    option<K extends string, D extends string>(name: K, desc: D, config?: Argv.OptionConfig): Command<A, Extend<O, K, Argv.OptionType<D>>>
    option(name: string, desc: string, config: Argv.OptionConfig = {}){
        const param = name
        const decl = desc.replace(/(?<=^|\s)[\w\x80-\uffff].*/, '')
        desc = desc.slice(decl.length)
        let syntax = decl.replace(/(?<=^|\s)(<[^<]+>|\[[^[]+\]).*/, '')
        const bracket = decl.slice(syntax.length)
        syntax = syntax.trim() || '--' + param

        const names: string[] = []
        const symbols: string[] = []
        for (let param of syntax.trim().split(',')) {
            param = param.trimStart()
            const name = param.replace(/^-+/, '')
            if (!name || !param.startsWith('-')) {
                symbols.push(param)
            } else {
                names.push(name)
            }
        }

        if (!config.value && !names.includes(param)) {
            syntax += ', --' + param
        }

        const declList = Argv.parseDecl(bracket)
        if (declList.stripped) syntax += ' ' + declList.stripped
        if (desc) syntax += '  ' + desc
        const option = this._options[name] ||= {
            ...declList[0],
            ...config,
            name,
            values: {},
            description: syntax,
        }

        const fallbackType = typeof option.fallback
        if ('value' in config) {
            names.forEach(name => option.values[name] = config.value)
        } else if (!bracket.trim()) {
            option.type = 'boolean'
        } else if (!option.type && (fallbackType === 'string' || fallbackType === 'number')) {
            option.type = fallbackType
        }

        this._assignOption(option, names, this._namedOptions)
        this._assignOption(option, symbols, this._symbolicOptions)
        if (!this._namedOptions[param]) {
            this._namedOptions[param] = option
        }
        return this
    }
    private _assignOption(option: Argv.OptionDeclaration, names: readonly string[], optionMap: Argv.OptionDeclarationMap) {
        for (const name of names) {
            if (name in optionMap) {
                throw new Error(format('duplicate option name "%s" for command "%s"', name, this.name))
            }
            optionMap[name] = option
        }
    }

    alias(...names: string[]) {
        for (const name of names) {
            this._aliases.push(name)
        }
        return this
    }
    example(example: string) {
        this._examples.push(example)
        return this
    }
    check(callback: Command.Action<A, O>, prepend = false) {
        if (prepend) {
            this._checkers.unshift(callback)
        } else {
            this._checkers.push(callback)
        }
        return this
    }
    action(callback: Command.Action<A, O>, append = false) {
        if (append) {
            this._actions.push(callback)
        } else {
            this._actions.unshift(callback)
        }
        return this
    }

    parse(argv: Argv): Argv
    parse(argv:Argv, terminator?: string, args = [], options = {}): Argv {
        const source = this.name + ' ' + Argv.stringify(argv)
        while (!argv.error && argv.tokens.length) {
            const token = argv.tokens[0]
            let { content, quoted } = token
            const argDecl = this._arguments[args.length]
            if (content[0] !== '-' && Argv.resolveConfig(argDecl?.type).greedy) {
                args.push(Argv.parseValue(Argv.stringify(argv), true, 'argument', argv, argDecl))
                break
            }

            argv.tokens.shift()
            let option: Argv.OptionDeclaration
            let names: string | string[]
            let param: string
            if (!quoted && (option = this._symbolicOptions[content])) {
                names = [option.name]
            } else {
                if (content[0] !== '-' || quoted) {
                    args.push(Argv.parseValue(content, quoted, 'argument', argv, argDecl || { type: 'string' }))
                    continue
                }
                let i = 0
                let name: string
                for (; i < content.length; ++i) {
                    if (content.charCodeAt(i) !== 45) break
                }
                if (content.slice(i, i + 3) === 'no-' && !this._namedOptions[content.slice(i)]) {
                    name = content.slice(i + 3)
                    options[name] = false
                    continue
                }

                // find =
                let j = i + 1
                for (; j < content.length; j++) {
                    if (content.charCodeAt(j) === 61) break
                }
                name = content.slice(i, j)
                names = i > 1 ? [name] : name
                param = content.slice(++j)
                option = this._namedOptions[names[names.length - 1]]
            }
            quoted = false
            if (!param) {
                const { type } = option || {}
                if (Argv.resolveConfig(type).greedy) {
                    param = Argv.stringify(argv)
                    quoted = true
                    argv.tokens = []
                } else if (type !== 'boolean' && argv.tokens.length && (type || argv.tokens[0]?.content !== '-')) {
                    const token = argv.tokens.shift()
                    param = token.content
                    quoted = token.quoted
                }
            }

            // handle each name
            for (let j = 0; j < names.length; j++) {
                const name = names[j]
                const optDecl = this._namedOptions[name]
                const key = optDecl ? optDecl.name : name
                if (optDecl && name in optDecl.values) {
                    options[key] = optDecl.values[name]
                } else {
                    const source = j + 1 < names.length ? '' : param
                    options[key] = Argv.parseValue(source, quoted, 'option', argv, optDecl)
                }
                if (argv.error) break
            }
        }

        // assign default values
        for (const { name, fallback } of Object.values(this._options)) {
            if (fallback !== undefined && !(name in options)) {
                options[name] = fallback
            }
        }

        delete argv.tokens
        return { options, args, source, rest: argv.rest, error: argv.error || '' }
    }
    async execute(argv:string|Argv){
        if(typeof argv==='string') argv=Argv.parse(argv)
        if(argv.tokens){
            const {content:name}=argv.tokens.shift()
            if(!this._aliases.includes(name)|| this.name!==name)return
        }else if(!this._aliases.includes(argv.name) || this.name!==argv.name)return;
        argv=this.parse(argv)
        const { args, error } = argv
        if (error) throw new Error(error)
        for (const validator of this._checkers) {
            const result = await validator.call(this, argv, ...args)
            if (result) return result
        }
        for (const action of this._actions) {
            const result = await action.call(this, argv, ...args)
            if (result) return result
        }
    }
    private stringifyArg(value: any) {
        value = '' + value
        return value.includes(' ') ? `"${value}"` : value
    }

    stringify(args: readonly string[], options: any) {
        let output = this.name
        for (const key in options) {
            const value = options[key]
            if (value === true) {
                output += ` --${key}`
            } else if (value === false) {
                output += ` --no-${key}`
            } else {
                output += ` --${key} ${this.stringifyArg(value)}`
            }
        }
        for (const arg of args) {
            output += ' ' + this.stringifyArg(arg)
        }
        return output
    }
}
export function defineCommand<D extends string>(def: D, config?: Command.Config): Command<Argv.ArgumentType<D>>
export function defineCommand<D extends string>(def: D, desc: string, config?: Command.Config): Command<Argv.ArgumentType<D>>
export function defineCommand(def: string, ...args: [Command.Config?] | [string, Command.Config?]) {
    const desc = typeof args[0] === 'string' ? args.shift() as string : ''
    const config = args[0] as Command.Config
    const name = def.split(' ', 1)[0]
    const decl = def.slice(name.length)
    const command=new Command(name,decl,desc)
    if(config){
        Object.assign(command.config, config)
    }
    return command
}
