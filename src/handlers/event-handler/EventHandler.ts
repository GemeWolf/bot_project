import process from "node:process";
import { getFilePaths, getFolderPaths } from "utils/get-paths.ts";
import { toFileURL } from "utils/resolve-file-url.ts";
import { clone } from "utils/clone.ts";
import colors from "utils/colors.ts";

import type {
  EventHandlerData,
  EventHandlerOptions,
} from "types/event-handler.ts";
import type { CommandHandler } from "handlers/mod.ts";

/**
 * A handler for client events.
 */
export class EventHandler {
  #data: EventHandlerData;

  constructor({ ...options }: EventHandlerOptions) {
    this.#data = {
      ...options,
      events: [],
    };
  }

  async init() {
    await this.#buildEvents();
    this.#registerEvents();
  }

  async #buildEvents() {
    const eventFolderPaths = await getFolderPaths(this.#data.eventsPath);

    for (const eventFolderPath of eventFolderPaths) {
      const eventName = eventFolderPath
        .replace(/\\\\|\\/g, "/")
        .split("/")
        .pop() as string;

      const allowedExtensions = /\.(js|mjs|cjs|ts)$/i;
      const eventPaths = await getFilePaths(eventFolderPath, true);

      const eventFilePaths = eventPaths.filter((path) =>
        allowedExtensions.test(path)
      );

      const eventObj = {
        name: eventName,
        // deno-lint-ignore ban-types
        functions: [] as Function[],
      };

      this.#data.events.push(eventObj);

      for (const eventFilePath of eventFilePaths) {
        const modulePath = toFileURL(eventFilePath);

        const importedFunction = (await import(`${modulePath}?t=${Date.now()}`))
          .default;
        let eventFunction = clone(importedFunction);

        if (eventFunction?.default) {
          eventFunction = eventFunction.default;
        }

        const compactFilePath = eventFilePath.split(process.cwd())[1] ||
          eventFilePath;

        if (typeof eventFunction !== "function") {
          process.emitWarning(
            colors.yellow(
              `Ignoring: Event file ${compactFilePath} does not export a function.`,
            ),
          );
          continue;
        }

        eventObj.functions.push(eventFunction);
      }
    }
  }

  #registerEvents() {
    const client = this.#data.client;

    for (const eventObj of this.#data.events) {
      client.on(eventObj.name, async (...params: unknown[]) => {
        for (const eventFunction of eventObj.functions) {
          const stopEventLoop = await eventFunction(...params, client);

          if (stopEventLoop) {
            break;
          }
        }
      });
    }
  }

  get events() {
    return this.#data.events;
  }

  async reloadEvents(commandHandler?: CommandHandler) {
    if (!this.#data.eventsPath) {
      throw new Error(
        colors.red(
          'Cannot reload events as "eventsPath" was not provided when instantiating DiscordBot.',
        ),
      );
    }

    this.#data.events = [];

    await this.#buildEvents();

    this.#data.client.removeAllListeners();

    this.#registerEvents();

    // Re-register "interactionCreate" event for application commands.
    commandHandler?.handleCommands();
  }
}