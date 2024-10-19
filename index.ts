import { Telegraf, Context } from "telegraf";
import { Update, Message } from "telegraf/typings/core/types/typegram";
import { CronJob } from "cron";
import axios from "axios";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN must be provided!");
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHATS_FILE = "chats.json";

type MyContext = Context<Update>;

let chats: Set<number> = new Set();
if (fs.existsSync(CHATS_FILE)) {
  const data = fs.readFileSync(CHATS_FILE, "utf-8");
  chats = new Set(JSON.parse(data));
}

async function getHolidays(): Promise<string> {
  try {
    const response = await axios.get("https://kakoysegodnyaprazdnik.ru/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Cache-Control": "max-age=0",
        Cookie: "PHPSESSID=dprtnn5u68ok509641nelges41",
        Dnt: "1",
      },
    });
    const $ = cheerio.load(response.data);

    const holidays = $(".listing_wr div.main > span:not(.img_wrapper)")
      .map((_, element) => $(element).text().trim())
      .get();

    if (holidays.length === 0) {
      return "Сегодня нет особых праздников.";
    }

    return holidays.join("\n");
  } catch (error) {
    console.error("Ошибка при получении праздников:", error);
    return "Извините, не удалось получить информацию о праздниках.";
  }
}

async function sendHolidays(ctx: MyContext): Promise<void> {
  const holidays = await getHolidays();
  await ctx.reply(`Праздники сегодня:\n\n${holidays}`);
}

bot.on("new_chat_members", (ctx: MyContext) => {
  const message = ctx.message as Message.NewChatMembersMessage;
  const newMembers = message.new_chat_members;
  const botUser = ctx.botInfo;

  if (newMembers.some((member) => member.id === botUser.id)) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }
    chats.add(chatId);
    saveChatIds();
    ctx.reply(
      "Привет! Я буду отправлять список праздников каждый день в 8:00 по МСК. Используйте команду /holidays, чтобы получить список праздников прямо сейчас."
    );
  }
});

bot.on("left_chat_member", (ctx: MyContext) => {
  const message = ctx.message as Message.LeftChatMemberMessage;
  const leftMember = message.left_chat_member;
  const botUser = ctx.botInfo;

  if (leftMember.id === botUser.id) {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }
    chats.delete(chatId);
    saveChatIds();
  }
});

function saveChatIds(): void {
  fs.writeFileSync(CHATS_FILE, JSON.stringify(Array.from(chats)));
}

bot.command("holidays", sendHolidays);

const job = new CronJob("00 8 * * *", async () => {
  const holidays = await getHolidays();
  for (const chatId of chats) {
    try {
      await bot.telegram.sendMessage(
        chatId,
        `Праздники сегодня:\n\n${holidays}`
      );
    } catch (error) {
      console.error(`Ошибка при отправке праздников в чат ${chatId}:`, error);
      if (
        error instanceof Error &&
        error.message.includes("Forbidden: bot was blocked by the user")
      ) {
        chats.delete(chatId);
        saveChatIds();
      }
    }
  }
});

job.start();

bot.launch(() => {
  console.log("Бот запустился!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
