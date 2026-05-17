/**
 * Public-facing user-onboarding page. Explains the two-layer access model
 * (site gate password + per-user Clerk account) and walks a new teammate
 * through getting in for the first time.
 *
 * Linked from the dashboard's user menu (Admin section) and from the
 * footer "Need access?" link. Bypasses Clerk auth via the demo-route
 * matcher in middleware.ts so anyone with the gate password can read it.
 */
import Link from "next/link";
import {
  Sparkles,
  KeyRound,
  UserPlus,
  Shield,
  Phone,
  ArrowLeft,
} from "lucide-react";

export const metadata = {
  title: "Onboarding · PPLT Intake Dashboard",
};

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-slate-50/50">
      <header className="border-b border-slate-200 bg-white/85 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_1px_2px_rgba(37,99,235,0.4)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">
                PPLT Intake Dashboard
              </h1>
              <p className="text-[11px] text-slate-500">Onboarding</p>
            </div>
          </Link>
          <Link
            href="/dashboard"
            className="text-xs text-slate-600 hover:text-blue-700 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-slate-900">
            Welcome to the dashboard
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Internal reporting for Pinder Plotkin Legal Team and Abogado Attorney.
            Two short steps to get in. Total: about 60 seconds.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 shrink-0">
              <KeyRound className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Step 1
              </div>
              <div className="text-base font-semibold text-slate-900">
                Enter the firm password
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Go to{" "}
            <a
              href="https://pplt-intake.vercel.app"
              className="text-blue-700 underline hover:text-blue-900"
            >
              pplt-intake.vercel.app
            </a>
            . You&apos;ll be prompted for the firm password. Ask Jason for the
            current value &mdash; this is the same for everyone and only has to be
            entered once per browser (saved in a signed cookie).
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 shrink-0">
              <UserPlus className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Step 2
              </div>
              <div className="text-base font-semibold text-slate-900">
                Create your own account
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            After the firm password, you&apos;ll see a sign-in screen. Click{" "}
            <strong>Sign up</strong> and create an account with your{" "}
            <span className="font-mono">@pinderplotkin.com</span> email. Verify your
            email (Clerk sends a code), set a password, and you&apos;re in.
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            By default you can see every dashboard section. If Jason has restricted
            specific sections for you, those will be hidden from your view.
          </p>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 space-y-2">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shrink-0">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <div className="text-base font-semibold text-amber-900">
                Admin? You&apos;ll see a few extras
              </div>
              <p className="text-sm text-amber-800 leading-relaxed mt-1">
                Admin accounts (configured in Vercel under{" "}
                <span className="font-mono text-xs">ADMIN_EMAILS</span>) get a{" "}
                <strong>Section visibility</strong> link in the user menu (top
                right). That opens <span className="font-mono text-xs">/admin</span>{" "}
                where you can toggle which sections each teammate can see. Admins
                also get the <strong>Refresh</strong> action and the{" "}
                <strong>Historical KPI CSV</strong> export.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <h3 className="text-base font-semibold text-slate-900">FAQ</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium text-slate-800">
                I forgot the firm password.
              </dt>
              <dd className="text-slate-600 mt-1">Ask Jason. Same value for everyone.</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">
                I forgot my Clerk password.
              </dt>
              <dd className="text-slate-600 mt-1">
                Click <strong>Sign in</strong> &rarr; <strong>Forgot password</strong>.
                Clerk emails a reset link.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">
                Some sections are blank or missing.
              </dt>
              <dd className="text-slate-600 mt-1">
                Either an admin restricted that section for you, or the underlying
                data sync hasn&apos;t fired yet (the section banner will say so).
                Ask Jason if you think you should be seeing something you&apos;re not.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">How fresh is the data?</dt>
              <dd className="text-slate-600 mt-1">
                Most sections refresh every 30 minutes from a snapshot.
                Conversation-driven Intake Team data refreshes every 4 hours.
                Click <strong>Refresh</strong> to force-sync (admins only).
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 shrink-0">
              <Phone className="h-4 w-4" />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900">
                Stuck? Reach Jason.
              </div>
              <p className="text-sm text-slate-600 leading-relaxed mt-1">
                Text or email for the firm password, or to be granted admin access.
                For visibility changes (hiding/showing specific sections for you),
                ask Jason to update your settings at <span className="font-mono text-xs">/admin</span>.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
