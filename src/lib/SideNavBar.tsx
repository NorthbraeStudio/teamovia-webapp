"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface SideNavBarProps {
  onLogout: () => void;
  currentPage: string;
  isMobileMenuOpen?: boolean;
  onCloseMobileMenu?: () => void;
}

export default function SideNavBar({
  onLogout,
  currentPage,
  isMobileMenuOpen = false,
  onCloseMobileMenu,
}: SideNavBarProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRoleLoading, setIsRoleLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (isMounted) {
          setIsAdmin(false);
          setIsRoleLoading(false);
        }
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        if (isMounted) {
          setIsAdmin(false);
          setIsRoleLoading(false);
        }
        return;
      }

      if (isMounted) {
        setIsAdmin(profile?.role === "admin");
        setIsRoleLoading(false);
      }
    };

    loadRole();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeClass =
    "bg-gradient-to-r from-[#ff706e]/20 to-transparent text-[#ff706e] border-l-4 border-[#ff706e]";
  const inactiveClass =
    "text-[#e7e2ff]/50 hover:text-[#e7e2ff] hover:bg-[#252147]/50 hover:translate-x-1";

  const navClass = (isActive: boolean) =>
    `flex items-center px-6 py-4 font-['Inter'] text-sm font-medium uppercase tracking-widest transition-all ${
      isActive ? activeClass : inactiveClass
    }`;

  const mobileNavClass = (isActive: boolean) =>
    `${navClass(isActive)} transition-[opacity,transform,background-color,color] duration-300 ${
      isMobileMenuOpen ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3"
    }`;

  const closeMenu = () => onCloseMobileMenu?.();

  return (
    <>
      <aside className="fixed left-0 top-0 h-full w-64 border-r border-[#47436c]/20 bg-[#0e0c20] flex-col pt-20 z-40 hidden lg:flex shadow-[20px_0_40px_rgba(0,0,0,0.4)]">
        <div className="px-6 py-8">
          <div className="flex items-center space-x-3 mb-1">
            <span className="text-xl font-black text-[#e9b3ff] font-['Inter'] uppercase">
              TEAMOVIA
            </span>
          </div>
          <p className="text-[#e7e2ff]/50 text-[10px] tracking-widest uppercase font-medium">
            Elite Analytics
          </p>
        </div>
        <div className="flex-grow">
          <nav className="space-y-1">
            <Link onClick={() => window.scrollTo(0, 0)} className={navClass(currentPage === "dashboard")} href="/">
              <span className="material-symbols-outlined mr-4">insights</span> Overview
            </Link>
            {!isRoleLoading && isAdmin && (
              <Link className={navClass(currentPage === "admin")} href="/admin">
                <span className="material-symbols-outlined mr-4">admin_panel_settings</span> Admin
              </Link>
            )}
            <Link className={navClass(false)} href="#">
              <span className="material-symbols-outlined mr-4">strategy</span> Tactics
            </Link>
            <Link className={navClass(false)} href="#">
              <span className="material-symbols-outlined mr-4">medical_services</span> Medical
            </Link>
          </nav>
        </div>
        <div className="px-6 pb-8 space-y-6">
          <button className="w-full py-3 bg-[#ff706e] text-[#0e0c20] font-bold text-xs tracking-widest rounded-full hover:opacity-90 transition-all active:scale-95">
            OPTIMISE SQUAD
          </button>
          <div className="pt-6 border-t border-[#47436c]/20 space-y-4">
            <Link className="flex items-center text-[#e7e2ff]/50 hover:text-[#e7e2ff] text-xs uppercase tracking-widest" href="#">
              <span className="material-symbols-outlined mr-3 text-sm">help</span> Help
            </Link>
            <button onClick={onLogout} className="flex items-center text-[#e7e2ff]/50 hover:text-[#e7e2ff] text-xs uppercase tracking-widest w-full text-left">
              <span className="material-symbols-outlined mr-3 text-sm">logout</span> Logout
            </button>
          </div>
        </div>
      </aside>

      <div
        className={`fixed inset-0 bg-black/60 z-40 lg:hidden transition-opacity duration-300 ${
          isMobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={closeMenu}
      ></div>

      <aside
        className={`fixed left-0 top-0 h-full w-[85vw] max-w-[320px] border-r border-[#47436c]/20 bg-[#0e0c20] pt-6 z-50 lg:hidden shadow-[20px_0_40px_rgba(0,0,0,0.4)] transition-transform duration-300 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 pb-6 border-b border-[#47436c]/20 flex items-center justify-between">
          <div>
            <p className="text-xl font-black text-[#e9b3ff] font-['Inter'] uppercase">TEAMOVIA</p>
            <p className="text-[#e7e2ff]/50 text-[10px] tracking-widest uppercase font-medium">Elite Analytics</p>
          </div>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={closeMenu}
            className="p-2 rounded-md text-[#e7e2ff] hover:bg-[#252147]/60 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="py-4">
          <nav className="space-y-1">
            <Link
              onClick={closeMenu}
              className={mobileNavClass(currentPage === "dashboard")}
              style={{ transitionDelay: isMobileMenuOpen ? "60ms" : "0ms" }}
              href="/"
            >
              <span className="material-symbols-outlined mr-4">insights</span> Overview
            </Link>
            {!isRoleLoading && isAdmin && (
              <Link
                onClick={closeMenu}
                className={mobileNavClass(currentPage === "admin")}
                style={{ transitionDelay: isMobileMenuOpen ? "110ms" : "0ms" }}
                href="/admin"
              >
                <span className="material-symbols-outlined mr-4">admin_panel_settings</span> Admin
              </Link>
            )}
            <Link
              onClick={closeMenu}
              className={mobileNavClass(false)}
              style={{ transitionDelay: isMobileMenuOpen ? "160ms" : "0ms" }}
              href="#"
            >
              <span className="material-symbols-outlined mr-4">strategy</span> Tactics
            </Link>
            <Link
              onClick={closeMenu}
              className={mobileNavClass(false)}
              style={{ transitionDelay: isMobileMenuOpen ? "210ms" : "0ms" }}
              href="#"
            >
              <span className="material-symbols-outlined mr-4">medical_services</span> Medical
            </Link>
          </nav>
        </div>

        <div
          className={`absolute bottom-0 left-0 right-0 px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-6 transition-[opacity,transform] duration-300 ${
            isMobileMenuOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
          style={{ transitionDelay: isMobileMenuOpen ? "300ms" : "0ms" }}
        >
          <button className="w-full py-3 bg-[#ff706e] text-[#0e0c20] font-bold text-xs tracking-widest rounded-full hover:opacity-90 transition-all active:scale-95">
            OPTIMISE SQUAD
          </button>
          <div className="pt-6 border-t border-[#47436c]/20 space-y-4">
            <Link onClick={closeMenu} className="flex items-center text-[#e7e2ff]/50 hover:text-[#e7e2ff] text-xs uppercase tracking-widest" href="#">
              <span className="material-symbols-outlined mr-3 text-sm">help</span> Help
            </Link>
            <button
              onClick={() => {
                closeMenu();
                onLogout();
              }}
              className="flex items-center text-[#e7e2ff]/50 hover:text-[#e7e2ff] text-xs uppercase tracking-widest w-full text-left"
            >
              <span className="material-symbols-outlined mr-3 text-sm">logout</span> Logout
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}