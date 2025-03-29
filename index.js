require('events').EventEmitter.prototype._maxListeners = 100000000
let Client = require('ssh2-sftp-client');
const fs = require('fs');
var archiver = require('archiver')
var moment = require('moment')
servers = JSON.parse(fs.readFileSync('./servers.json', 'utf8'));
delete_after_days = JSON.parse(fs.readFileSync('./config.json', 'utf8'))["delete_after_days"]
const ping = require('ping');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function download_path(sftp, directory, server) {
    const list = await sftp.list(directory);
    await Promise.all(list.map(async file => {
        if (file["type"] === "-") {
            const buffer = await sftp.get(directory + file["name"])
            console.log(directory + file["name"])
            fs.writeFileSync('./'+server["name"]+'/'+directory + file["name"], buffer)
        } else if (file["type"] === "d" && server["ignore_dirs"].indexOf(file["name"]) === -1) {
            console.log(directory + file["name"] + "/");
            if (!fs.existsSync("./"+server["name"]+directory + file["name"] + "/")) fs.mkdirSync("./"+server["name"]+directory + file["name"] + "/")
            await download_path(sftp, directory + file["name"] + "/", server);
        }
    }));
}


async function checkConnection(ip) {
    goida = await ping.promise.probe(ip)
    if (goida.alive) {console.log(`Подключение к ${ip} есть!`); return true}
    else {console.log(`Нет подключения к ${ip}, повторная проверка через 10 секунд`); await delay(10000); checkConnection()}
}


let currentDate = new Date().toLocaleDateString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit' });
if(fs.readFileSync('./last_backup.txt', 'utf8') == currentDate) return console.log("Сегодня бекап уже был сделан! Выключение...")
fs.writeFileSync('./last_backup.txt', currentDate)


servers.forEach(async server => {
    let sftp = new Client();
    try {
        await checkConnection(`${server["host"]}`)
        await sftp.connect({
            host: server["host"],
            port: server["port"],
            username: server["username"],
            password: server["password"]
        });
        if (!fs.existsSync("./"+server["name"]+"/")) fs.mkdirSync("./"+server["name"]+"/") 
        await download_path(sftp, "/", server)
    } catch (error) {
        console.error(`Ошибка во время обработки сервера ${server.host}:`, error);
    } finally {
        await sftp.end()
        if (!fs.existsSync(`./backups/`)) fs.mkdirSync(`./backups/`) 
        if (!fs.existsSync(`./backups/${server["name"]}/`)) fs.mkdirSync(`./backups/${server["name"]}/`) 
        output = fs.createWriteStream(`./backups/${server["name"]}/${currentDate}.zip`)
        archive = archiver('zip')
        output.on('close', async function () {
            console.log(`${server["name"]} заархивирован`)
            fs.rmSync(`./${server["name"]}/`, { recursive: true, force: true });
            
            if (delete_after_days == 0) return;

            fs.readdir(`./backups/${server["name"]}`, (err, files) => {
                for (filename of files) {
                    diffDays = moment(currentDate, "DD.MM.YYYY").diff(moment(filename.slice(0, -4), "DD.MM.YYYY"), 'days');
                    if (diffDays > delete_after_days) {
                        fs.rmSync(`./backups/${server["name"]}/${filename}`, { recursive: true, force: true });
                        console.log(`Удалён старый бекап: /${server["name"]}/${filename}`)
                    }
                }
            })
        });
        archive.pipe(output)
        archive.directory(`./${server["name"]}/`, false)
        archive.finalize()
    }
});