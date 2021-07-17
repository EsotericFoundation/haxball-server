import { Server } from "./server";
import * as Discord from 'discord.js';
import os from "node-os-utils";
import fs from "fs";
import pidusage from "pidusage";
import process from "process";

type BotList = { [key: string]: string };

interface PainelConfig {
    discordToken: string;
    discordPrefix: string;
    bots: BotList;
    mastersDiscordId: string[];
}

export class ServerPainel {
    private _client = new Discord.Client();

    private _cpu = os.cpu;
    private _mem = os.mem;

    private _prefix: string;
    private _token: string;

    private _mastersDiscordId: string[];

    private _bots: BotList;

    constructor(private _server: Server, config: PainelConfig) {
        this._prefix = config.discordPrefix;
        this._token = config.discordToken;
        this._mastersDiscordId = config.mastersDiscordId;

        this._bots = config.bots;

        this._client.on('ready', () => {
            console.log(`Logged in as ${this._client.user?.tag}!`);        
        });

        this._client.on('message', async msg => {
            try {
                this._command(msg);
            } catch (e) {
                this._logError(e, msg.channel as Discord.TextChannel);
            }
        });

        this._client.login(this._token);
    }

    private async _logError(e: Error | string, channel: Discord.TextChannel) {    
        const embed = new Discord.MessageEmbed()
            .setColor('#0099ff')
            .setTitle("Log Error")
            .setTimestamp(Date.now())
            .setDescription(e);
    
        await channel.send(embed);
    }

    private async _getRoomNameList() {
        let rooms = [];

        for (const browser of this._server.browsers) {
            const page = (await browser.pages())[0];
            const proxyServer = browser["proxyServer"];
    
            rooms.push({ name: `${await page.title()} (${page.browser().process()?.pid})`, proxy: proxyServer });
        }

        if (rooms.length === 0) return "There are no open rooms!";
        if (rooms.every(r => r.proxy == null)) return rooms.map(r => r.name).join("\n");

        let proxyRooms: { text: string, proxy: string }[] = [];

        for (const room of rooms) {
            let pRoom = proxyRooms.find(r => r.proxy === room.proxy);

            if (pRoom) {
                pRoom.text += room.name + "\n";
            } else {
                proxyRooms.push({ text: room.name + "\n", proxy: room.proxy });
            }
        }
        
        return proxyRooms.map(r => `• ${r.proxy}\n${r.text}`).join("\n");
    }

    private async _getRoomUsageList() {
        const roomsUsage: { process: pidusage.Status, title: string }[] = [];
    
        for (const browser of this._server.browsers) {
            const page = (await browser.pages())[0];
            
            roomsUsage.push({ process: await pidusage(browser?.process()?.pid as number), title: await page.title() });
        }
    
        return roomsUsage;
    }

    private async _command(msg: Discord.Message) {
        if (!msg.content.startsWith(this._prefix)) return;

        const args = msg.content.slice(this._prefix.length).trim().split(' ');
        const text = msg.content.slice(this._prefix.length).trim().replace(args[0] + " ", "");
        const command = args.shift()?.toLowerCase();

        const embed = new Discord.MessageEmbed().setColor('#0099ff');
    
        if (this._mastersDiscordId.includes(msg.author.id)) {
            if (command === "help") {
                embed
                    .setTitle("Help")
                    .setDescription("Haxball Server is a small server utility for Haxball rooms.")
                    .addField("help", "Command list.", true)
                    .addField("info", "Server info.", true)
                    .addField("meminfo", "CPU and memory info.", true)
                    .addField("open", "Open a room.", true)
                    .addField("close", "Close a room.", true)
                    .addField("exit", "Close the server.", true)
                    .addField("eval", "Execute Javascript.", true)
                    .addField("tokenlink", "Haxball Headless Token page.", true);
    
                msg.channel.send(embed);
            }
    
            if (command === "tokenlink") {
                embed
                    .setTitle("Headless Token")
                    .setDescription(`[Click here.](https://www.haxball.com/headlesstoken)`);
    
                msg.channel.send(embed);
            }
    
            if (command === "open") {
                embed.setTitle("Open room");

                const token = text.replace(args[0] + " ", "").replace(/\"/g, "").replace("Token obtained: ", "");

                if (!Object.keys(this._bots).includes(args[0])) {
                    embed.setDescription(`This bot does not exist. Type ${this._prefix}info to see the list of available bots.`);
    
                    return msg.channel.send(embed);
                }
    
                if (!token) {
                    embed.setDescription(`You have to define a headless token [token](https://www.haxball.com/headlesstoken) as second argument: ${this._prefix}open <bot> <token>`);
                }
    
                fs.readFile(this._bots[args[0]], { encoding: 'utf-8' }, async (err, data) => {
                    if (err) {
                        embed.setDescription("Error: " + err);
                    } else {
                        try {
                            const e = await this._server.open(data, token);
    
                            embed.setDescription(`Room running! [Click here to join.](${e?.link})\nBrowser process: ${e?.pid}`);
                        } catch (e) {
                            embed.setDescription(`Unable to open the room!\n ${e}`);
                        }
                    }
    
                    msg.channel.send(embed);
                });
            }
    
            if (command === "info") {
                const roomList = await this._getRoomNameList();
                const files = Object.keys(this._bots);
    
                embed
                    .setTitle("Information")
                    .addField("Open rooms", roomList)
                    .addField("Bot list", files.join("\n"));
    
                msg.channel.send(embed);
            }
    
            if (command === "meminfo") {
                const embedLoading = new Discord.MessageEmbed()
                    .setColor('#0099ff')
                    .setTitle("Information")
                    .setDescription("Loading...");
    
                const message = await msg.channel.send(embedLoading);
    
                const roomsUsage = await this._getRoomUsageList();
    
                const memInfo = await this._mem.info();
                const cpuUsage = await this._cpu.usage();
    
                embed
                    .setTitle("Information")
                    .addField("CPUs", this._cpu.count(), true)
                    .addField("CPU usage", cpuUsage + "%", true)
                    .addField("Free CPU", 100 - cpuUsage + "%", true)
                    .addField("Memory", `${(memInfo.usedMemMb / 1000).toFixed(2)}/${(memInfo.totalMemMb / 1000).toFixed(2)} GB (${memInfo.freeMemPercentage}% livre)`, true)
                    .addField("OS", await os.os.oos(), true)
                    .addField("Machine Uptime", new Date(os.os.uptime() * 1000).toISOString().substr(11, 8), true)
                
                const serverPIDUsage = await pidusage(process.pid);
    
                const serverCPUUsage = `CPU server usage: ${(serverPIDUsage.cpu).toFixed(2)}%\nMemory server usage: ${(serverPIDUsage.memory * 1e-6).toFixed(2)} MB\n`;
                const roomCPUMessage = this._server.browsers.length > 0 ? "\n" + roomsUsage.map((room) => `**${room.title} (${room.process.pid})**:\n${(room.process.cpu).toFixed(2)}% CPU\n${(room.process.memory * 1e-6).toFixed(2)} MB memory\n`).join("\n") : "";
    
                embed.setDescription(serverCPUUsage + roomCPUMessage + "\n");
    
                message.edit(embed);
            }
    
            if (command === "close") {
                embed
                    .setTitle("Close room")
                    .setDescription("Unable to find room");
    
                const res = await this._server.close(text);
    
                if (res) {
                    embed.setDescription("Room closed!");
                }
    
                msg.channel.send(embed);
            }
    
            if (command === "exit") {
                embed
                    .setTitle("Closing")
                    .setDescription("Closing server...");
    
                await msg.channel.send(embed);
    
                this._server.browsers.forEach(async browser => {
                    await browser.close();
                });
    
                process.exit();
            }

            if (command === "eval") {
                try {
                    const code = args.join(" ");
                    let evaled = eval(code);
               
                    if (typeof evaled !== "string") evaled = require("util").inspect(evaled);
               
                    msg.channel.send(evaled, { code: "javascript", split: true });
                } catch (err) {
                    msg.channel.send(`\`ERROR\` \`\`\`xl\n${err}\n\`\`\``);
                }
            }
        }
    }
}