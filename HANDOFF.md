# Augora — سند انتقال پروژه (Handoff)

> این سند را در ابتدای چتِ جدید بده تا بدونِ توضیحِ اضافه ادامه بدهی.
> نقش Claude: **مهندس فول‌استک ارشد + هم‌فکرِ محصول**. توضیح‌ها فارسی، کد/نام‌ها انگلیسی، UI کاملاً انگلیسی.

---

## ۰) قرارداد کاری (مهم)

- **توضیح‌ها فارسی، صادقانه و بی‌طرف.** هیچ گنده‌گویی؛ همیشه بگو چه چیزی محکم است و چه چیزی ناقص/شکننده.
- **کد، نام‌ها، و کلِ UI انگلیسی.** هیچ فارسی در UI.
- منبعِ حقیقت: `PROJECT_SPEC.md` (قوانین/دیتامدل/API) و `PayoffBuilder.html` (منطقِ calc). در `/mnt/project/`.
- بعد از هر تغییر: **typecheck → build → curl smoke-test → zip** و آخرِ پیام یک خلاصه‌ی فارسیِ کوتاه: «چی تغییر کرد» + «چی رو باید ببینی».
- خروجی همیشه: zip در `/mnt/user-data/outputs/augora.zip` با `present_files`. zip نباید پوشه‌ی bracket `[id]` داشته باشد (مشکلِ اکسترکتِ ویندوز).
- محیطِ Claude به اینترنت/Polymarket دسترسی **ندارد** (`Host not in allowlist`) → کدِ مربوط به Polymarket را Claude نمی‌تواند مستقیم تست کند؛ کاربر (ویندوز، نتِ آزاد) تست می‌کند. منطقِ غیرشبکه‌ای را Claude با curl/tsx تست می‌کند.
- کاربر روی **ویندوز / PowerShell** است: `curl` آن‌جا `Invoke-WebRequest` است؛ برای تستِ APIها از مرورگر یا `curl.exe`/`Invoke-WebRequest` استفاده کند.

## ۶ ناوردای پولیِ غیرقابلِ‌مذاکره (همیشه باید برقرار بمانند)
1. price(YES)+price(NO)=$1
2. کاملاً وثیقه‌دار، بدونِ اهرم، max loss = premium، bad debt = 0
3. conservation: Σ همه‌ی حساب‌ها = 0
4. بدونِ موجودیِ منفی
5. تسویه اتمیک و idempotent
6. پول همیشه integer cents (بدونِ float)

---

## ۱) محصول (Augora) — یک‌خطی

بازارِ پیش‌بینیِ **کاملاً وثیقه‌دار** (رقیبِ Polymarket/Kalshi) با سه تمایز:
1. **Strategy Builder** (چندلگ + نمودار payoff) به‌جای فقط Yes/No.
2. **سنجشِ edge/EV** (باور کاربر → ارزشِ مورد انتظار).
3. **بدونِ اهرم/liquidation** (ضدِ Kalshi Perps؛ ضررِ قفل‌شده).

فاز فعلی: **دمو** برای قابلِ‌آزمایش‌کردنِ فرضیه. بزرگ‌ترین چالش‌های واقعی (نه کد): **نقدینگی، مجوز (CFTC/KYC)، و پیدا کردنِ مخاطبِ میانی.** محصول ≠ کسب‌وکار.

ایده‌ی کلیدیِ کاربر (در حالِ پیاده‌سازی): **paper-trading روی دیتای واقعیِ Polymarket** با پولِ مجازی — تا نبودِ نقدینگیِ خودمان دور زده شود.

---

## ۲) معماری و اجرا

مونوریپوِ TypeScript با npm workspaces:
- `packages/core` — منطقِ خالص (calc, ledger, matching, settlement, money, fees, types, marketTypes). تک‌منبعِ حقیقت.
- `packages/server` — Fastify REST + WebSocket؛ in-memory + SQLite persistence.
- `apps/web` — Next.js 14 (App Router) + Tailwind.

**اجرا (روی دستگاهِ کاربر):**
```
npm install
npm run dev        # API روی :4000  (بعد از تغییرِ بک باید Ctrl+C و دوباره اجرا شود)
npm run dev:web    # وب روی :3000  (ترمینالِ دوم)
npm test           # ۱۷ تستِ هسته
```
- persistence: فایلِ `augora.db` (node:sqlite، بدونِ وابستگیِ native). پاک‌کردنش = شروعِ تازه. در zip نیست.
- Claude برای تست: `AUGORA_DB=/tmp/x.db PORT=4000 npx tsx packages/server/src/index.ts` + `npx next start`.
- zip: `cd /home/claude && zip -rq /mnt/user-data/outputs/augora.zip augora -x 'augora/node_modules/*' -x '*/node_modules/*' -x 'augora/apps/web/.next/*' -x '*/.git/*' -x '*.log' -x '*.tsbuildinfo' -x '*.db'`
- نکته‌ی build: یک warningِ بی‌خطرِ Google-Fonts minify در سندباکس هست (غیرفتال).

---

## ۳) فایل‌های فعلی (همه ساخته و کارکن)

**core/src:** calc.ts, money.ts, fees.ts, types.ts, marketTypes.ts (checkBinary/Categorical/Ladder), ledger.ts (double-entry + snapshot/load), matching.ts (CLOB، mint-on-cross + sell/merge + previewMultiLeg + snapshot/load), settlement.ts (atomic/idempotent + get/snapshot/load), index.ts.

**server/src:** store.ts (Store؛ positionsWithMtm، snapshot/restore، ensureUser auto-deposit $10k=1,000,000¢)، seed.ts (۳ بازار: BTC binary، IRAN-US-PEACE ladder، NOMINEE-2028 categorical؛ MM bot)، routes.ts، hub.ts (WS)، persistence.ts (node:sqlite kv + debounce)، **livedata.ts** (proxy Polymarket Gamma + cache 10s + normalize)، **liveimport.ts** (import بازارِ live + requote + syncLivePrices + syncLiveSettlements)، index.ts (boot + timerها).

**web:** app/layout.tsx (هدر+فونت Inter)، app/page.tsx (Markets)، app/market/page.tsx (تب Trade/Strategy)، app/live/page.tsx (Live)، app/portfolio/page.tsx. components: QuickTrade (Buy/Sell + دلاری)، StrategyBuilder، ResolvePanel (تسویه تکی + گروهی)، OutcomeRows، OutcomeLadder، PriceChart، MarketCharts، Sparkline، PayoffChart، Onboarding. lib/api.ts (کلاینت).

---

## ۴) فیچرهای کامل‌شده (همه تست‌شده: ۱۷ تست سبز، build پاس، curl تأیید)

1. **هسته‌ی پولی:** calc، ledger دوطرفه، matching (mint-on-cross)، settlement. ۶ ناوردا enforce و تست‌شده.
2. **سه نوع بازار:** binary, ladder (مونوتونِ صعودی), categorical (Σ≈100¢).
3. **صفحه Markets** (سبک Polymarket): دسته‌بندی، جستجو، کارت‌های گزینه‌دار، sparkline.
4. **صفحه بازار:** تبِ **Trade** (نمودار+order book+buy-box) و **Strategy** (Strategy Builder + جای Templates). نشانِ نوع/دسته. برای بازارهای import‌شده نشانِ «Paper · Polymarket».
5. **buy-box (QuickTrade):** Buy/Sell toggle، Yes/No، **مبلغ به دلار** (+$1/+$10/...) با «≈ N shares»، market/limit، پیش‌نمایشِ fill/slippage واقعی (عمق‌آگاه)، Max loss. در Sell موجودی را نشان می‌دهد و پیش‌فرض می‌بندد. خطِ راهنمای ترجمه‌ی حالت (Buy/Sell×Yes/No = ۴ حالت).
6. **فروش/exit (مکانیزم):** sell = خریدِ سمتِ مقابل + **merge** (هر جفت ۱۰۰¢ از escrow برمی‌گردد). بستنِ موجودی = آزادسازیِ وثیقه؛ فروشِ مازاد = بازکردنِ شورت (مثلِ Write). تست‌شده با conservation.
7. **اجرای اتمیکِ چندلگ:** `/strategy/execute` (همه یا هیچ؛ پیش‌نمایشِ کل سبد، اگر market legها کامل پر نشوند ۴۰۹).
8. **Strategy Builder:** ۴ لگ (Buy/Write/BuyAgainst/WriteAgainst)، payoff chart، EV، fee = `None/Standard/High` (اسم Kalshi حذف شد).
9. **تسویه (single + GROUP):** پنلِ Resolve. **گروهی:** categorical = یک برنده (بقیه NO)؛ ladder = اولین آستانه‌ی محقق + همه‌ی بعدی‌ها YES (شمولی، مثلِ option chain). endpoint `/admin/groups/:groupId/settle`. تست‌شده.
10. **پرتفوی:** موجودی، پوزیشن‌ها (عنوانِ واقعیِ بازار + نشانِ Paper/won/lost)، realized/unrealized P&L.
11. **persistence (SQLite):** کلِ state با restart می‌مانَد.
12. **UI:** Inter، سفیدِ تمیز، سبز/قرمز روشن، تمام‌عرض ~1280px، دکمه‌ی سبز. نمودارِ area با grid/محور/crosshair/last-price. قیمتِ زنده flash می‌زند.
13. **LIVE / paper-trading روی Polymarket:**
    - `/live` بازارهای واقعیِ Polymarket را نشان می‌دهد (cache 10s، refresh 10s، آیکون، حجم، تغییرِ امروز).
    - کلیک → **import به موتورِ خودمان** (binary، با قیمتِ واقعی + MM). فرانت آبجکتِ بازار را در body می‌فرستد تا نیازی به fetch دوباره نباشد.
    - paper-trade کامل (خرید/فروش/استراتژی)، پوزیشن در همان پرتفوی.
    - **sync قیمت هر ۳۰s:** `syncLivePrices` سفارش‌های MM را دورِ قیمتِ جدیدِ Polymarket بازچینی می‌کند (پوزیشنِ کاربر دست‌نخورده؛ MTM زنده). تست‌شده.
    - **تسویه‌ی خودکار هر ۶۰s:** `syncLiveSettlements` وقتی Polymarket resolve کند، بازارِ paper را با همان نتیجه تسویه می‌کند.

---

## ۵) endpointهای سرور

GET: `/markets`, `/markets/:id`, `/markets/:id/orderbook`, `/markets/:id/trades`, `/markets/:id/history`, `/me/balance`, `/me/positions`, `/me/history`, `/admin/markets/:id/risk`, `/health`, `/live/markets`, `/live/markets/:id`
POST: `/orders` (body شامل `action:"buy"|"sell"`), `/strategy/preview`, `/strategy/fill-preview`, `/strategy/execute`, `/admin/markets/:id/settle`, `/admin/groups/:groupId/settle`, `/live/markets/:id/import` (body اختیاری `{market}`)
DELETE: `/orders/:id`
WS: `/markets/:id/stream`
- userId از هدرِ `x-user-id` (پیش‌فرض "playground").

---

## ۶) کارِ در حال انجام (دقیقاً همین‌جا متوقف شدیم) ⬅️ از این‌جا ادامه بده

**هدف: import‌کردنِ بازارهای categoricalِ واقعیِ Polymarket به‌صورتِ گروه.**

وضعیت: مکانیزمِ گروهیِ categorical/ladder **کامل و تست‌شده است** (در بازارهای seed خودمان کار می‌کند). اما `liveimport.ts` فعلاً **فقط دو گزینه‌ی اول (Yes/No) را به‌صورتِ یک بازارِ binary** import می‌کند. پس categoricalهای Polymarket (مسابقات، انتخاباتِ چندنفره) در Live ناقص‌اند.

**قدمِ بعد:** import را گسترش بده تا یک **event با چند market** را به‌صورتِ یک **گروه** (چند بازارِ هم‌groupId) بیاورد:
1. endpoint/منطقِ خواندنِ **events** از Polymarket (نه فقط markets): `https://gamma-api.polymarket.com/events?closed=false&limit=...&order=volume&ascending=false`.
2. هر event با چند گزینه → یک گروه: چند بازارِ binary با یک `groupId` مشترک، هر کدام قیمتِ واقعیِ گزینه‌اش.
3. تشخیصِ نوع: `negRisk:true` (یا «یکی برنده») → **categorical**؛ آستانه‌های صعداتی‌دار → **ladder**؛ وگرنه گزینه‌های مستقل.
4. UI (صفحه بازار + ResolvePanel + Markets) **خودکار** گروه را نشان می‌دهد چون منطقِ گروهی از قبل هست.

**اولین کارِ لازم در چتِ جدید:** کاربر باید خروجیِ این لینک را از مرورگر بدهد تا ساختارِ `events` نگاشت شود (Claude نمی‌تواند خودش بزند):
```
https://gamma-api.polymarket.com/events?closed=false&limit=2&order=volume&ascending=false
```
دنبالِ این فیلدها: آیا event یک آرایه‌ی `markets` دارد؟ فیلدهای هر market (`question`, `groupItemTitle`, `outcomes`, `outcomePrices`)؟ فیلدِ `negRisk`؟

> یادداشت: `livedata.ts` فعلاً فقط `getLiveMarket`/`listLiveMarkets` روی `/markets` دارد. باید `listLiveEvents`/`getLiveEvent` روی `/events` اضافه شود و `importLiveMarket` به یک `importLiveEvent` گروهی گسترش/مکمل یابد. `Market` در core فیلدهای اختیاری `source/sourceId/sourceSlug` دارد.

---

## ۷) نقشه‌ی راهِ بزرگ‌تر (بعد از categoricalِ live)

- **فاز A (تقریباً تمام):** فروش/exit ✅، candlestick واقعی (هنوز area است — کتابخانه مثل lightweight-charts باقی مانده)، MM بهتر، اوراکلِ نیمه‌واقعی (برای Live تا حد زیادی از طریقِ Polymarket حل شده).
- **فاز B — حساب و پول:** auth، چند کاربرِ واقعی، wallet (واریز/برداشت)، داشبوردِ حساب.
- **فاز C — زیرساخت:** Postgres (ledger)، Redis (order book/real-time)، تراکنشِ اتمیکِ DB، concurrency-safe. (enforceِ سختِ Σ=100¢ برای categorical این‌جا می‌رود — فعلاً فقط نرم/MM است.)
- **فاز D — رشد/انطباق:** مدلِ درآمدی، CFTC/KYC/AML، پنلِ ادمین.

کارهای ریزِ باقی‌مانده: candlestick library، templates در تبِ Strategy (placeholder آماده است)، sync دوره‌ایِ خودِ لیستِ Live.

---

## ۸) جزئیاتِ فنیِ مهم (برای اینکه اشتباه نشود)

- **مدلِ بازار:** هر گزینه‌ی categorical/ladder یک **بازارِ binary مستقل** با escrowِ جداست؛ گروه فقط با `groupId` مشترک منطقی است. تسویه‌ی گروهی = تسویه‌ی هر عضو با نتیجه‌ی درست (conservation هر کدام مستقل).
- **فروش (sell):** `eng.sell({userId,side,type,priceCents?,qty})` = submit(buy opposite, price=100−p) سپس `mergeUser` (collapse min(yes,no)، payout 100¢/pair).
- **قیمتِ preview** در calc لایه‌ی fractional-dollar دارد؛ ledger لایه‌ی integer-cent. قاطی نشوند.
- **`calc()` تک‌منبع:** هم فرانت (StrategyBuilder) هم بک (`/strategy/preview`) از همین استفاده می‌کنند؛ تکراری نشود.
- **importLiveMarket(store, liveId, provided?)** — اگر `provided` (آبجکتِ بازار از فرانت) باشد، fetch نمی‌کند (دور زدنِ Bad Request و نت).
- **requote(store, marketId, fairYesC)** — `cancelUserOrders("mm-bot")` سپس quote دوباره؛ پوزیشن دست‌نخورده.
- بازارهای import‌شده id = `LIVE-{polymarketId}`، `source:"polymarket"`, `sourceId`, `sourceSlug`.
- timerها در `index.ts`: قیمت هر ۳۰s، تسویه هر ۶۰s.

---

## ۹) دستورِ شروعِ چتِ جدید (به Claude بگو)

> «این HANDOFF.md پروژه‌ی Augora است؛ بخوانش. از بخشِ ۶ (import categoricalِ Polymarket) ادامه می‌دهیم. پروژه در `/mnt/project/` (اسپک) و کدِ کامل در zip هست — اول کد را در `/home/claude/augora` اکسترکت کن، `npm install` بزن، تست‌ها را اجرا کن تا مطمئن شوی همه‌چیز سبز است، بعد ادامه بده. خروجیِ Polymarket events را برایت می‌فرستم.»

(فایلِ zip کاملِ کد را هم در همان پیامِ اول به چتِ جدید آپلود کن.)
