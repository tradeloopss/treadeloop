import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { getLocale } from "@/lib/i18n/server"

export async function generateMetadata() {
  return { title: (await getLocale()) === "ar" ? "شروط الخدمة — TradeLoop" : "Terms of Service — TradeLoop" }
}

// The English text is the binding one; the Arabic version is a courtesy
// translation and says so at the top. Both share the page frame below.
export default async function TermsPage() {
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
        {locale === "ar" ? <TermsArabic /> : <TermsEnglish />}
      </div>
    </div>
  )
}

function TermsEnglish() {
  return (
    <>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: September 2026</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Agreement to terms</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          By creating an account or using TradeLoop (&quot;the Service&quot;), you agree to these Terms of Service. If you don&apos;t
          agree, don&apos;t use the Service. We may update these terms from time to time; continued use after a change means you
          accept the updated terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. What TradeLoop is</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          TradeLoop is a trading journal and analytics tool. It lets you log trades manually or sync them automatically from
          supported brokers and prop firms, and it computes journaling, performance, and prop-firm evaluation statistics from
          that data. <strong className="text-foreground">TradeLoop is not a broker, is not a prop firm, and does not provide
          financial, investment, or trading advice.</strong> Nothing in the Service is a recommendation to buy, sell, or hold any
          security or instrument.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Not a substitute for your broker or prop firm&apos;s own records</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Statistics shown in TradeLoop — including prop-firm pass/breach status, drawdown, and profit-target progress — are
          computed from the trade data available to us and are provided as a convenience tracker only. They are not an official
          ruling from any prop firm. Always confirm your account status, balance, and evaluation outcome directly with your
          broker or prop firm before making decisions based on it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Your account</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          You&apos;re responsible for keeping your login credentials secure and for all activity under your account. You must
          provide accurate information when creating an account and keep it up to date.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Broker & prop firm connections</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          If you connect a broker or prop firm account (e.g. via Rithmic or MetaTrader), you&apos;re granting TradeLoop
          permission to read your trade history for the sole purpose of importing and journaling it. Connection credentials are
          encrypted at rest. You can disconnect a broker or prop firm account at any time from Settings.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Subscriptions & billing</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Paid plans are billed through our payment processor (Whop) on a recurring basis until cancelled. Prices and features
          for each plan are listed on our <Link href="/pricing" className="text-primary hover:underline">pricing page</Link>.
          You can cancel at any time; access continues until the end of the current billing period. Fees are non-refundable
          except where required by law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. Acceptable use</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Don&apos;t misuse the Service — no attempting to access other users&apos; data, reverse-engineering the platform, or
          using it to violate any applicable law or a third party&apos;s (e.g. your broker&apos;s or prop firm&apos;s) terms of
          service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">8. Disclaimer & limitation of liability</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The Service is provided &quot;as is&quot; without warranties of any kind. TradeLoop is not liable for trading losses,
          missed profit targets, account breaches, or any decision made based on data shown in the app. To the maximum extent
          permitted by law, our total liability for any claim related to the Service is limited to the amount you paid us in the
          12 months before the claim.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">9. Termination</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          You can stop using the Service and delete your account at any time. We may suspend or terminate accounts that violate
          these terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">10. Contact</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Questions about these terms? Email us at{" "}
          <a href="mailto:support@tradeloop.pro" className="text-primary hover:underline">support@tradeloop.pro</a>.
        </p>
      </section>
    </>
  )
}

function TermsArabic() {
  return (
    <>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">شروط الخدمة</h1>
        <p className="mt-2 text-sm text-muted-foreground">آخر تحديث: سبتمبر 2026</p>
        <p className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          هذه ترجمة للتسهيل. في حال وجود أي اختلاف، يُعتمد النص الإنجليزي لشروط الخدمة.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. الموافقة على الشروط</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          بإنشاء حساب أو استخدام TradeLoop («الخدمة»)، فإنك توافق على شروط الخدمة هذه. إن لم توافق، فلا تستخدم الخدمة. قد نحدّث
          هذه الشروط من وقت لآخر؛ ويعني استمرار الاستخدام بعد أي تغيير قبولك للشروط المحدَّثة.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. ما هو TradeLoop</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          TradeLoop أداة يومية تداول وتحليلات. يتيح لك تسجيل الصفقات يدويًا أو مزامنتها تلقائيًا من الوسطاء وشركات التمويل
          المدعومة، ويحسب من تلك البيانات إحصاءات اليومية والأداء وتقييم شركات التمويل.{" "}
          <strong className="text-foreground">TradeLoop ليس وسيطًا، وليس شركة تمويل، ولا يقدّم نصائح مالية أو استثمارية أو
          تداولية.</strong>{" "}
          لا شيء في الخدمة يُعدّ توصية بشراء أو بيع أو الاحتفاظ بأي ورقة مالية أو أداة.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. ليس بديلًا عن سجلات وسيطك أو شركة التمويل</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          الإحصاءات المعروضة في TradeLoop — بما فيها حالة النجاح/المخالفة لدى شركة التمويل، والتراجع، والتقدّم نحو هدف الربح —
          تُحسب من بيانات الصفقات المتاحة لنا وتُقدَّم كأداة متابعة للتسهيل فقط. وهي ليست حكمًا رسميًا من أي شركة تمويل. تأكد
          دائمًا من حالة حسابك ورصيدك ونتيجة تقييمك مباشرةً من وسيطك أو شركة التمويل قبل اتخاذ قرارات بناءً عليها.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. حسابك</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          أنت مسؤول عن الحفاظ على سرية بيانات دخولك وعن كل نشاط يتم عبر حسابك. يجب أن تقدّم معلومات دقيقة عند إنشاء الحساب وأن
          تحافظ على تحديثها.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. الربط مع الوسطاء وشركات التمويل</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          عند ربط حساب وسيط أو شركة تمويل (مثلًا عبر Rithmic أو MetaTrader)، فإنك تمنح TradeLoop إذنًا بقراءة سجل صفقاتك لغرض
          وحيد هو استيرادها وتدوينها. تُشفَّر بيانات الاتصال أثناء التخزين. يمكنك فصل حساب الوسيط أو شركة التمويل في أي وقت من
          الإعدادات.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. الاشتراكات والفواتير</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          تُحصَّل رسوم الخطط المدفوعة عبر معالج الدفع الخاص بنا (Whop) بشكل دوري حتى الإلغاء. الأسعار والميزات لكل خطة مدرجة في{" "}
          <Link href="/pricing" className="text-primary hover:underline">صفحة الأسعار</Link>. يمكنك الإلغاء في أي وقت؛ ويستمر
          الوصول حتى نهاية فترة الفوترة الحالية. الرسوم غير قابلة للاسترداد إلا حيث يقتضي القانون ذلك.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. الاستخدام المقبول</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          لا تسئ استخدام الخدمة — لا تحاول الوصول إلى بيانات مستخدمين آخرين، أو الهندسة العكسية للمنصة، أو استخدامها لمخالفة أي
          قانون معمول به أو شروط خدمة طرف ثالث (مثل وسيطك أو شركة التمويل).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">8. إخلاء المسؤولية وحدود المسؤولية</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          تُقدَّم الخدمة «كما هي» دون ضمانات من أي نوع. TradeLoop غير مسؤول عن خسائر التداول، أو عدم تحقيق أهداف الربح، أو
          مخالفات الحسابات، أو أي قرار يُتخذ بناءً على بيانات معروضة في التطبيق. وإلى الحد الأقصى الذي يسمح به القانون، تقتصر
          مسؤوليتنا الإجمالية عن أي مطالبة متعلقة بالخدمة على المبلغ الذي دفعته لنا خلال الاثني عشر شهرًا السابقة للمطالبة.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">9. الإنهاء</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          يمكنك التوقف عن استخدام الخدمة وحذف حسابك في أي وقت. وقد نعلّق أو ننهي الحسابات التي تخالف هذه الشروط.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">10. التواصل</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          لديك أسئلة حول هذه الشروط؟ راسلنا على{" "}
          <a href="mailto:support@tradeloop.pro" className="text-primary hover:underline">support@tradeloop.pro</a>.
        </p>
      </section>
    </>
  )
}
