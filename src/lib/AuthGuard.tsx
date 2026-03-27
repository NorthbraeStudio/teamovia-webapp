"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Listen for auth state changes. `onAuthStateChange` fires an initial event 
    // with the current session, so we don't need a separate `getSession()` call.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push("/login");
      } else {
        setIsAuthenticated(true);
      }
    });

    // Cleanup listener on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  // Show a generic loading state while we verify their identity
  if (isAuthenticated === null) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">Authorising...</div>;
  }

  return <>{children}</>;
}