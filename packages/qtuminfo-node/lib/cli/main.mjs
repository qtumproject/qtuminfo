import path from 'path'
import Liftoff from 'liftoff'
import program from 'commander'
import packageJson from '../../package.json'
import QtumNode from './node'

process.on('unhandledRejection', reason => console.error(reason))

let liftoff = new Liftoff({
  name: 'qtuminfo',
  moduleName: 'qtuminfo-node',
  configName: 'qtuminfo-node',
  processTitle: 'qtuminfo'
})
  .on('require', name => {
    console.log('Loading:', name)
  })
  .on('requireFail', (name, err) => {
    console.error('Unable to load:', name, err)
  })
  .on('respawn', (flags, child) => {
    console.log('Detected node flags:', flags)
    console.log('Respawned to PID', child.pid)
  })

liftoff.launch({cwd: process.cwd}, () => {
  program
    .version(packageJson.version)

  program
    .command('start')
    .description('Start the current node')
    .option('-c, --config <dir>', 'Specify the directory with Qtuminfo Node configuration')
    .action(async cmd => {
      let config = (await import(path.resolve(
        process.cwd(),
        ...cmd.config ? [cmd.config] : [],
        'qtuminfo-node.json'
      ))).default
      let node = new QtumNode({path: process.cwd(), config})
      await node.start()
    })

  program.parse(process.argv)
  if (process.argv.length === 2) {
    program.help()
  }
})
