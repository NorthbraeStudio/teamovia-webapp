"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const getRedirectPathForUser = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) return "/";
      return profile?.role === "admin" ? "/admin" : "/";
    } catch {
      return "/";
    }
  };

  useEffect(() => {
    // Redirect users with an active session to their role-specific landing page.
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user?.id) {
        const redirectPath = await getRedirectPathForUser(session.user.id);
        router.replace(redirectPath);
      }
    };

    checkSession();
  }, [router]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        router.replace(`/signup-success?email=${encodeURIComponent(email)}`);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        const userId = data.user?.id;
        const redirectPath = userId ? await getRedirectPathForUser(userId) : "/";
        router.replace(redirectPath);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .nebula-gradient {
            background: radial-gradient(circle at 20% 30%, rgba(233, 179, 255, 0.15) 0%, transparent 40%),
                        radial-gradient(circle at 80% 70%, rgba(210, 119, 255, 0.1) 0%, transparent 40%),
                        linear-gradient(180deg, #0e0c20 0%, #000000 100%);
        }
        .glass-card {
            background: rgba(37, 33, 71, 0.4);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            box-shadow: inset 1px 1px 0px 0px rgba(71, 67, 108, 0.3), 0 20px 40px rgba(0, 0, 0, 0.4);
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .primary-gradient {
            background: linear-gradient(135deg, #ff706e 0%, #dd4648 100%);
        }
    `}</style>
      <div className="nebula-gradient min-h-screen flex items-center justify-center p-6 relative text-on-surface">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] bg-secondary/10 blur-[120px] rounded-full"></div>
          <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-primary/5 blur-[100px] rounded-full"></div>
          <div className="absolute inset-0 flex items-center justify-center opacity-12 mix-blend-overlay">
            <Image
              alt="Background atmosphere"
              src="/vecteezy_close-up-of-many-soccer-players-kicking-a-football-on-a_27829023.webp"
              fill
              className="object-cover"
              priority
            />
          </div>
        </div>

        <main className="w-full max-w-[1200px] grid grid-cols-1 lg:grid-cols-12 gap-12 items-center z-10">
          <section className="hidden lg:flex lg:col-span-7 flex-col gap-8">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl primary-gradient flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="material-symbols-outlined text-white text-3xl">insights</span>
              </div>
              <h1 className="text-3xl font-black tracking-tighter text-on-surface">Teamovia AI</h1>
            </div>
            <div className="space-y-6">
              <h2 className="text-5xl xl:text-7xl font-bold tracking-tight text-on-surface leading-[1.1]">
                Optimise your <span className="text-secondary">squad&apos;s</span> performance with TEAMOVIA AI.
              </h2>
              <p className="text-xl text-on-surface-variant max-w-xl leading-relaxed">
                Access elite-level tactical analytics, insights, and forecasting in one unified digital dashboard.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div className="p-6 rounded-lg glass-card border border-outline-variant/10">
                <div className="text-3xl font-bold text-primary mb-1">98%</div>
                <div className="text-xs font-medium uppercase tracking-widest text-on-surface-variant">Accuracy Rate</div>
              </div>
              <div className="p-6 rounded-lg glass-card border border-outline-variant/10">
                <div className="text-3xl font-bold text-secondary mb-1">500+</div>
                <div className="text-xs font-medium uppercase tracking-widest text-on-surface-variant">Elite Clubs</div>
              </div>
            </div>
          </section>

          <section className="lg:col-span-5 flex flex-col items-center lg:items-end">
            <div className="w-full max-w-md glass-card rounded-lg p-10 lg:p-12 border border-outline-variant/20 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-3xl -mr-16 -mt-16 group-hover:bg-primary/20 transition-colors duration-500"></div>
              <div className="mb-10 text-center lg:text-left">
                <div className="lg:hidden flex justify-center mb-6">
                  <div className="w-10 h-10 rounded-lg primary-gradient flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-2xl">insights</span>
                  </div>
                </div>
                <h3 className="text-3xl font-bold text-on-surface mb-2">{isSignUp ? "Create an Account" : "Welcome back"}</h3>
                <p className="text-on-surface-variant">{isSignUp ? "Join the elite and start analysing." : "Enter your credentials to access the dashboard."}</p>
              </div>

              {error && <div className="mb-4 p-3 bg-error-container/50 border border-error text-on-error-container rounded-lg text-sm">{error}</div>}
              <form onSubmit={handleAuth} className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-widest text-on-surface-variant ml-1" htmlFor="email">Email Address</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">alternate_email</span>
                    <input
                      className="w-full bg-surface-container-lowest border-none rounded-full py-4 pl-12 pr-6 text-on-surface focus:ring-2 focus:ring-secondary/30 transition-all placeholder:text-outline/50"
                      id="email" name="email" placeholder="coach@teamovia.com" type="email"
                      value={email} onChange={(e) => setEmail(e.target.value)} required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-1">
                    <label className="block text-xs font-medium uppercase tracking-widest text-on-surface-variant" htmlFor="password">Password</label>
                    {!isSignUp && <a className="text-xs font-medium text-secondary hover:text-secondary-fixed transition-colors" href="#">Forgot?</a>}
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">lock</span>
                    <input
                      className="w-full bg-surface-container-lowest border-none rounded-full py-4 pl-12 pr-6 text-on-surface focus:ring-2 focus:ring-secondary/30 transition-all placeholder:text-outline/50"
                      id="password" name="password" placeholder="••••••••" type="password"
                      value={password} onChange={(e) => setPassword(e.target.value)} required
                    />
                  </div>
                </div>
                <button
                  className="w-full primary-gradient text-white font-bold py-4 rounded-full shadow-lg shadow-primary/30 hover:shadow-primary/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  type="submit" disabled={loading}
                >
                  {loading ? "Processing..." : isSignUp ? "Create Account" : "Log In"}
                </button>
              </form>

              <div className="mt-10 text-center">
                <p className="text-on-surface-variant">
                  {isSignUp ? "Already have an account?" : "New to Teamovia?"}
                  <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(null); }} className="text-primary font-bold hover:underline transition-all ml-1">
                    {isSignUp ? "Log In" : "Create an account"}
                  </button>
                </p>
              </div>
            </div>
            <footer className="mt-8 flex gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-outline/60">
              <a className="hover:text-on-surface transition-colors" href="#">Privacy Policy</a>
              <a className="hover:text-on-surface transition-colors" href="#">Terms of Service</a>
              <span>© 2026 Teamovia AI LTD</span>
            </footer>
          </section>
        </main>

        <div className="fixed bottom-[-15%] right-[-10%] w-[800px] h-[800px] bg-primary/5 blur-[150px] rounded-full pointer-events-none -z-10"></div>
        <div className="fixed top-[-20%] left-[-10%] w-[1000px] h-[1000px] bg-secondary/5 blur-[180px] rounded-full pointer-events-none -z-10"></div>
      </div>
    </>
  );
}