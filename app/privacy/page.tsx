import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { getLocale } from "@/lib/i18n/server"

export async function generateMetadata() {
  return { title: (await getLocale()) === "ar" ? "سياسة الخصوصية — TradeLoop" : "Privacy Policy — TradeLoop" }
}

// The English text is the binding one; the Arabic version is a courtesy
// translation and says so at the top. Both share the page frame below.
export default async function PrivacyPage() {
  const locale = await getLocale()
  return (
    <div className="min-h-svh bg-gradient-to-b from-background to-accent/20 px-4 py-16">
      <div className="mx-auto mb-10 flex max-w-3xl items-center justify-center gap-2">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">TradeLoop</span>
        </Link>
      </div>

      <div className="mx-auto max-w-3xl space-y-8 rounded-2xl border bg-card p-8 sm:p-10">
        {locale === "ar" ? <PrivacyArabic /> : <PrivacyEnglish />}
      </div>
    </div>
  )
}

function PrivacyEnglish() {
  return (
    <>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: September 2026</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. What we collect</h2>
        <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted-foreground">
          <li><strong className="text-foreground">Account info</strong> — name and email, used for login and account identification.</li>
          <li><strong className="text-foreground">Trading data</strong> — trades you enter manually or that sync from a connected broker/prop firm account (symbol, entry/exit price, size, P&amp;L, timestamps, notes, tags you add).</li>
          <li><strong className="text-foreground">Broker/prop firm connection credentials</strong> — encrypted at rest, used only to fetch your own trade history from that broker/firm on your behalf.</li>
          <li><strong className="text-foreground">Billing info</strong> — handled entirely by our payment processor (Whop); we never see or store your card details.</li>
          <li><strong className="text-foreground">Usage data</strong> — basic analytics (pages visited, feature usage) to help us improve the product.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. How we use it</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We use your data to operate the Service: displaying your trades and journal, computing analytics and prop-firm
          evaluation status, syncing new trades from connected accounts, processing subscriptions, and responding to support
          requests. If you have an automated journal narrative feature enabled, a summary of your day&apos;s trades may be sent
          to a third-party AI provider (Anthropic) to generate that narrative — no broker credentials or account numbers are
          included in that request.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Who we share it with</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We don&apos;t sell your data. We share the minimum necessary with the services that make TradeLoop work:
        </p>
        <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted-foreground">
          <li><strong className="text-foreground">Whop</strong> — subscription billing.</li>
          <li><strong className="text-foreground">Rithmic / MetaApi</strong> — live broker and prop firm trade sync, only for accounts you explicitly connect.</li>
          <li><strong className="text-foreground">Anthropic</strong> — automated journal narrative generation, if that feature is used.</li>
          <li><strong className="text-foreground">Our hosting and database providers</strong> — to run the Service.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Data security</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Broker and prop firm connection credentials are encrypted at rest. Access to your data is restricted to your own
          authenticated session. No method of transmission or storage is 100% secure, but we take reasonable steps to protect
          your information.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Data retention & deletion</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We keep your data for as long as your account is active. You can delete individual trades, accounts, or broker
          connections at any time from within the app. To delete your entire account and all associated data, contact us at the
          email below.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Your rights</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          You can access, correct, export, or delete your data at any time. Depending on where you live, you may have
          additional rights under laws like the GDPR or CCPA — contact us and we&apos;ll help.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. Cookies</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We use essential cookies to keep you signed in and to remember preferences like your selected accounts, language and
          theme. We don&apos;t use third-party advertising cookies.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">8. Contact</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Questions about this policy or your data? Email{" "}
          <a href="mailto:support@tradeloop.pro" className="text-primary hover:underline">support@tradeloop.pro</a>.
        </p>
      </section>
    </>
  )
}

function PrivacyArabic() {
  return (
    <>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">سياسة الخصوصية</h1>
        <p className="mt-2 text-sm text-muted-foreground">آخر تحديث: سبتمبر 2026</p>
        <p className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          هذه ترجمة للتسهيل. في حال وجود أي اختلاف، يُعتمد النص الإنجليزي لسياسة الخصوصية.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. ما الذي نجمعه</h2>
        <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted-foreground">
          <li><strong className="text-foreground">معلومات الحساب</strong> — الاسم والبريد الإلكتروني، لتسجيل الدخول والتعريف بالحساب.</li>
          <li><strong className="text-foreground">بيانات التداول</strong> — الصفقات التي تدخلها يدويًا أو تتزامن من حساب وسيط/شركة تمويل مربوط (الرمز، سعر الدخول/الخروج، الحجم، الربح/الخسارة، الأوقات، الملاحظات، والوسوم التي تضيفها).</li>
          <li><strong className="text-foreground">بيانات الاتصال بالوسيط/شركة التمويل</strong> — مشفَّرة أثناء التخزين، وتُستخدم فقط لجلب سجل صفقاتك من ذلك الوسيط/الشركة بالنيابة عنك.</li>
          <li><strong className="text-foreground">معلومات الفوترة</strong> — يتولاها بالكامل معالج الدفع الخاص بنا (Whop)؛ لا نرى بيانات بطاقتك ولا نخزّنها أبدًا.</li>
          <li><strong className="text-foreground">بيانات الاستخدام</strong> — تحليلات أساسية (الصفحات المزارة، استخدام الميزات) لمساعدتنا على تحسين المنتج.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. كيف نستخدمها</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          نستخدم بياناتك لتشغيل الخدمة: عرض صفقاتك ويوميتك، وحساب التحليلات وحالة تقييم شركات التمويل، ومزامنة الصفقات الجديدة من
          الحسابات المربوطة، ومعالجة الاشتراكات، والرد على طلبات الدعم. إذا كانت ميزة السرد التلقائي لليومية مفعَّلة، فقد يُرسَل
          ملخص لصفقات يومك إلى مزوّد ذكاء اصطناعي خارجي (Anthropic) لإنشاء ذلك السرد — دون تضمين أي بيانات اتصال بالوسيط أو أرقام
          حسابات في ذلك الطلب.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. مع من نشاركها</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          لا نبيع بياناتك. نشارك الحد الأدنى اللازم مع الخدمات التي تُشغّل TradeLoop:
        </p>
        <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted-foreground">
          <li><strong className="text-foreground">Whop</strong> — فوترة الاشتراكات.</li>
          <li><strong className="text-foreground">Rithmic / MetaApi</strong> — المزامنة المباشرة لصفقات الوسطاء وشركات التمويل، للحسابات التي تربطها صراحةً فقط.</li>
          <li><strong className="text-foreground">Anthropic</strong> — إنشاء السرد التلقائي لليومية، إن استُخدمت تلك الميزة.</li>
          <li><strong className="text-foreground">مزوّدو الاستضافة وقواعد البيانات</strong> — لتشغيل الخدمة.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. أمان البيانات</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          تُشفَّر بيانات الاتصال بالوسطاء وشركات التمويل أثناء التخزين. الوصول إلى بياناتك مقصور على جلستك المصادَق عليها. لا توجد
          وسيلة نقل أو تخزين آمنة بنسبة 100%، لكننا نتخذ خطوات معقولة لحماية معلوماتك.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. الاحتفاظ بالبيانات وحذفها</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          نحتفظ ببياناتك ما دام حسابك نشطًا. يمكنك حذف صفقات أو حسابات أو اتصالات وسطاء فردية في أي وقت من داخل التطبيق. لحذف حسابك
          بالكامل وكل البيانات المرتبطة به، تواصل معنا على البريد أدناه.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. حقوقك</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          يمكنك الوصول إلى بياناتك وتصحيحها وتصديرها وحذفها في أي وقت. وبحسب مكان إقامتك، قد تكون لك حقوق إضافية بموجب قوانين مثل
          GDPR أو CCPA — تواصل معنا وسنساعدك.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. ملفات تعريف الارتباط (الكوكيز)</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          نستخدم ملفات تعريف ارتباط أساسية لإبقائك مسجَّل الدخول وتذكّر تفضيلاتك مثل الحسابات المحددة واللغة والمظهر. لا نستخدم
          ملفات تعريف ارتباط إعلانية من أطراف ثالثة.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">8. التواصل</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          لديك أسئلة حول هذه السياسة أو بياناتك؟ راسلنا على{" "}
          <a href="mailto:support@tradeloop.pro" className="text-primary hover:underline">support@tradeloop.pro</a>.
        </p>
      </section>
    </>
  )
}
