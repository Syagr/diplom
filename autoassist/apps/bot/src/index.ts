import 'dotenv/config';
import { Telegraf, Markup, Context } from 'telegraf';
import axios from 'axios';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const API_URL = process.env.API_URL || 'http://localhost:8080';
const WEBAPP_URL = process.env.BOT_WEBAPP_URL || 'http://localhost:5173/tg';

// User session storage (in production, use Redis)
const userSessions = new Map<number, any>();

// Helper function to get user session
const getSession = (userId: number) => {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, { step: 'start', data: {} });
  }
  return userSessions.get(userId);
};

// Helper function to create order via API
const createOrder = async (orderData: any) => {
  try {
    const response = await axios.post(`${API_URL}/api/orders`, orderData);
    return response.data;
  } catch (error: any) {
    console.error('Error creating order:', error.response?.data || error.message);
    throw error;
  }
};

// Start command
bot.start(async (ctx) => {
  const session = getSession(ctx.from!.id);
  session.step = 'start';
  
  await ctx.reply(
    `🚗 Вітаємо в AutoAssist+!

Я допоможу вам швидко оформити заявку на ремонт автомобіля.

Оберіть дію:`,
    Markup.keyboard([
      ['🆕 Нова заявка'],
      ['📋 Мої заявки', '📱 Відкрити WebApp'],
      ['ℹ️ Про сервіс']
    ]).resize()
  );
});

// Menu handlers
bot.hears('🆕 Нова заявка', async (ctx) => {
  const session = getSession(ctx.from!.id);
  session.step = 'plate';
  session.data = {};
  
  await ctx.reply(
    '🚗 Введіть номерний знак вашого автомобіля\n(наприклад: AA1234BB):',
    Markup.keyboard([['🚫 Скасувати']]).resize()
  );
});

bot.hears('📱 Відкрити WebApp', async (ctx) => {
  await ctx.reply(
    '🌐 Відкривається WebApp для детального управління заявками:',
    Markup.inlineKeyboard([
      Markup.button.webApp('🚀 Відкрити AutoAssist+', WEBAPP_URL)
    ])
  );
});

bot.hears('📋 Мої заявки', async (ctx) => {
  await ctx.reply('🔍 Пошук ваших заявок... (функція в розробці)');
});

bot.hears('ℹ️ Про сервіс', async (ctx) => {
  await ctx.reply(`
🏢 AutoAssist+ — це сучасна платформа для автосервісу

✨ Можливості:
• 🚗 Швидке оформлення заявок
• 📍 Виклик евакуатора
• 💰 Прозора оплата через блокчейн
• 🎯 Персоналізовані страхові пакети
• 🏆 Система лояльності та досягнень
• 🔐 Біометрична безпека

💬 Для початку натисніть "Нова заявка"
  `);
});

bot.hears('🚫 Скасувати', async (ctx) => {
  const session = getSession(ctx.from!.id);
  session.step = 'start';
  session.data = {};
  
  await ctx.reply(
    '❌ Операцію скасовано',
    Markup.keyboard([
      ['🆕 Нова заявка'],
      ['📋 Мої заявки', '📱 Відкрити WebApp'],
      ['ℹ️ Про сервіс']
    ]).resize()
  );
});

// Order creation flow
bot.on('text', async (ctx) => {
  const session = getSession(ctx.from!.id);
  const text = ctx.message.text;

  switch (session.step) {
    case 'plate':
      // Validate plate format (basic)
      if (!/^[A-Z]{2}\d{4}[A-Z]{2}$/i.test(text.replace(/\s/g, ''))) {
        await ctx.reply(
          '❌ Неправильний формат номера. Введіть номер у форматі AA1234BB:'
        );
        return;
      }
      
      session.data.plate = text.replace(/\s/g, '').toUpperCase();
      session.step = 'category';
      
      await ctx.reply(
        '🔧 Оберіть категорію проблеми:',
        Markup.keyboard([
          ['🚗 Двигун', '⚙️ Трансмісія'],
          ['🔌 Електрика', '🛞 Підвіска'],
          ['🛑 Гальма', '🔧 Інше'],
          ['🚫 Скасувати']
        ]).resize()
      );
      break;

    case 'category':
      const categoryMap: { [key: string]: string } = {
        '🚗 Двигун': 'engine',
        '⚙️ Трансмісія': 'transmission',
        '🔌 Електрика': 'electrical',
        '🛞 Підвіска': 'suspension',
        '🛑 Гальма': 'brakes',
        '🔧 Інше': 'other'
      };
      
      if (!categoryMap[text]) {
        await ctx.reply('❌ Оберіть категорію з клавіатури:');
        return;
      }
      
      session.data.category = categoryMap[text];
      session.step = 'description';
      
      await ctx.reply(
        '📝 Опишіть проблему детальніше\n(або натисніть "Пропустити"):',
        Markup.keyboard([['➡️ Пропустити', '🚫 Скасувати']]).resize()
      );
      break;

    case 'description':
      if (text !== '➡️ Пропустити') {
        session.data.description = text;
      }
      session.step = 'location';
      
      await ctx.reply(
        '📍 Надішліть вашу геолокацію або введіть адресу:',
        Markup.keyboard([
          [Markup.button.locationRequest('📍 Надіслати локацію')],
          ['➡️ Пропустити', '🚫 Скасувати']
        ]).resize()
      );
      break;

    case 'location':
      if (text !== '➡️ Пропустити') {
        session.data.address = text;
      }
      
      // Create order
      await createOrderFromSession(ctx, session);
      break;

    default:
      if (session.step === 'start') {
        await ctx.reply(
          '🤔 Не розумію. Оберіть дію з меню:',
          Markup.keyboard([
            ['🆕 Нова заявка'],
            ['📋 Мої заявки', '📱 Відкрити WebApp'],
            ['ℹ️ Про сервіс']
          ]).resize()
        );
      }
      break;
  }
});

// Handle location sharing
bot.on('location', async (ctx) => {
  const session = getSession(ctx.from!.id);
  
  if (session.step === 'location') {
    session.data.location = {
      lat: ctx.message.location.latitude,
      lng: ctx.message.location.longitude
    };
    
    await createOrderFromSession(ctx, session);
  } else {
    await ctx.reply('📍 Локацію отримано, але зараз вона не потрібна.');
  }
});

// Create order from session data
async function createOrderFromSession(ctx: Context, session: any) {
  const userId = ctx.from!.id;
  const userName = ctx.from!.first_name || 'Telegram User';
  
  try {
    await ctx.reply('⏳ Створюємо заявку...');
    
    const orderData = {
      client: {
        name: userName,
        phone: `tg:${userId}`,
        tgUserId: userId.toString()
      },
      vehicle: {
        plate: session.data.plate
      },
      category: session.data.category,
      description: session.data.description,
      channel: 'telegram',
      pickup: session.data.location ? {
        lat: session.data.location.lat,
        lng: session.data.location.lng,
        address: session.data.address
      } : undefined
    };

    const result = await createOrder(orderData);
    
    await ctx.reply(
      `✅ Заявка #${result.order.id} створена успішно!

📋 Деталі:
• Номер: ${session.data.plate}
• Категорія: ${session.data.category}
• Статус: ${result.order.status}

🔔 Ми надішлемо сповіщення про оновлення статусу.`,
      Markup.inlineKeyboard([
        [Markup.button.webApp('📱 Переглянути в WebApp', `${WEBAPP_URL}?order=${result.order.id}`)],
        [Markup.button.callback('🆕 Створити ще одну заявку', 'new_order')]
      ])
    );
    
    // Reset session
    session.step = 'start';
    session.data = {};
    
  } catch (error: any) {
    console.error('Error creating order:', error);
    await ctx.reply(
      '❌ Помилка при створенні заявки. Спробуйте ще раз або зверніться до підтримки.',
      Markup.keyboard([
        ['🆕 Нова заявка'],
        ['📋 Мої заявки', '📱 Відкрити WebApp'],
        ['ℹ️ Про сервіс']
      ]).resize()
    );
    
    session.step = 'start';
    session.data = {};
  }
}

// Handle callback queries
bot.action('new_order', async (ctx) => {
  await ctx.answerCbQuery();
  
  const session = getSession(ctx.from!.id);
  session.step = 'plate';
  session.data = {};
  
  await ctx.reply(
    '🚗 Введіть номерний знак автомобіля для нової заявки:',
    Markup.keyboard([['🚫 Скасувати']]).resize()
  );
});

// Error handling
bot.catch((err: any, ctx: Context) => {
  console.error('Bot error:', err);
  ctx.reply('😵 Сталася помилка. Спробуйте ще раз.');
});

// Start bot
console.log('🤖 Starting AutoAssist+ Telegram Bot...');
bot.launch()
  .then(() => {
    console.log('✅ Bot started successfully');
    console.log(`📱 WebApp URL: ${WEBAPP_URL}`);
  })
  .catch((error) => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));