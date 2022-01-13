# command
指令系统
## Usage
1.安装
```shell
npm install @lc-cn/command
```
2.样例
```typescript
import {defineCommand} from "@lc-cn/command";
function sleep(ms){
    return new Promise(resolve => {
        setTimeout(resolve,ms)
    })
}
const cmd=defineCommand('test <a> [b:number]')
    .option('hello','-h <who:number>')
    .option('world','-w')
    .action(async ({options},a,b)=>{
        console.log('我是传入的参数',[a,b])
        await sleep(3000)
        console.log('我3秒后返回')
        return options
    })
cmd.execute('test asdf 22 -h 你好 -w').then((res)=>{
    console.log(res)
}).catch(e=>{
    console.error(e.message)
})

```