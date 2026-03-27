"use client";

import Link from "next/link";

interface SideNavBarProps {
  onLogout: () => void;
  currentPage: string;
}

export default function SideNavBar({ onLogout, currentPage }: SideNavBarProps) {
  return (
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
          <Link onClick={() => window.scrollTo(0, 0)} className={`flex items-center px-6 py-4 font-['Inter'] text-sm font-medium uppercase tracking-widest transition-all ${currentPage === "dashboard" ? "bg-gradient-to-r from-[#ff706e]/20 to-transparent text-[#ff706e] border-l-4 border-[#ff706e]" : "text-[#e7e2ff]/50 hover:text-[#e7e2ff] hover:bg-[#252147]/50 hover:translate-x-1"}`} href="/">
            <span className="material-symbols-outlined mr-4">insights</span> Overview
          </Link>
          <Link className={`flex items-center px-6 py-4 font-['Inter'] text-sm font-medium uppercase tracking-widest transition-all ${currentPage === "analysis" ? "bg-gradient-to-r from-[#ff706e]/20 to-transparent text-[#ff706e] border-l-4 border-[#ff706e]" : "text-[#e7e2ff]/50 hover:text-[#e7e2ff] hover:bg-[#252147]/50 hover:translate-x-1"}`} href="/analysis">
            <span className="material-symbols-outlined mr-4">speed</span> Performance
          </Link>
          <Link className="flex items-center px-6 py-4 text-[#e7e2ff]/50 hover:text-[#e7e2ff] hover:bg-[#252147]/50 font-['Inter'] text-sm font-medium uppercase tracking-widest transition-all hover:translate-x-1" href="#">
            <span className="material-symbols-outlined mr-4">strategy</span> Tactics
          </Link>
          <Link className="flex items-center px-6 py-4 text-[#e7e2ff]/50 hover:text-[#e7e2ff] hover:bg-[#252147]/50 font-['Inter'] text-sm font-medium uppercase tracking-widest transition-all hover:translate-x-1" href="#">
            <span className="material-symbols-outlined mr-4">medical_services</span> Medical
          </Link>
          <Link className="flex items-center px-6 py-4 text-[#e7e2ff]/50 hover:text-[#e7e2ff] hover:bg-[#252147]/50 font-['Inter'] text-sm font-medium uppercase tracking-widest transition-all hover:translate-x-1" href="#">
            <span className="material-symbols-outlined mr-4">payments</span> Finances
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
  );
}