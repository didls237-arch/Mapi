import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { commandsJson } from "../discord/commands.js";

async function main(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
    { body: commandsJson }
  );
  console.log(`Registered ${commandsJson.length} command(s) to guild ${config.DISCORD_GUILD_ID}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});