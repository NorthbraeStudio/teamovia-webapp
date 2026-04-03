"use client";

interface TeamInfo {
  id: string;
  name: string;
}

interface TopNavBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  hideSearch?: boolean;
  teams?: TeamInfo[];
  selectedTeamId?: string | null;
  onTeamChange?: (teamId: string) => void;
  tasScore?: number | null;
  onToggleMenu?: () => void;
  isMenuOpen?: boolean;
}

export default function TopNavBar({
  searchValue = "",
  onSearchChange,
  hideSearch = false,
  teams = [],
  selectedTeamId = null,
  onTeamChange,
  tasScore = null,
  onToggleMenu,
  isMenuOpen = false,
}: TopNavBarProps) {
  return (
    <nav className="fixed top-0 w-full z-50 bg-slate-950/40 backdrop-blur-xl border-b border-[#47436c]/20 shadow-[0_20px_40px_rgba(0,0,0,0.4)] flex justify-between items-center px-3 sm:px-6 py-3 gap-2">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <button
          type="button"
          aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isMenuOpen}
          onClick={onToggleMenu}
          className="lg:hidden p-2 rounded-md text-[#e7e2ff] hover:bg-[#252147]/60 transition-colors"
        >
          <span className="material-symbols-outlined">{isMenuOpen ? "close" : "menu"}</span>
        </button>
        <span className="text-base sm:text-xl font-bold tracking-tighter text-[#e7e2ff] font-['Inter'] whitespace-nowrap">
          TEAMOVIA AI
        </span>
      </div>
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        {/* Team selector dropdown */}
        {teams.length > 0 && (
          <select
            value={selectedTeamId || ""}
            onChange={(e) => onTeamChange?.(e.target.value)}
            className="max-w-[120px] sm:max-w-none text-xs sm:text-sm font-medium rounded-full px-2 sm:px-3 py-2 bg-slate-800 text-white border border-[#7b82a1]/40 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="" disabled>
              Select team
            </option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}

        {/* Overall Team Health TAS Indicator */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-surface-container-highest rounded-full border border-outline-variant/20">
          <span className="text-[10px] font-bold tracking-widest text-secondary uppercase">
            Overall Team Health
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs font-black text-on-surface">
              TAS {tasScore?.toFixed(1) ?? "—"}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]"></span>
          </div>
        </div>
        {!hideSearch && (
        <div className="relative group">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
            search
          </span>
          <input
            className="hidden md:block bg-surface-container-lowest border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-1 focus:ring-primary/40 w-48 md:w-64 transition-all"
            placeholder="Search matches..."
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
          />
        </div>
        )}
        <div className="hidden sm:flex items-center gap-2 ml-1 sm:ml-2">
          <button className="p-2 text-on-surface-variant hover:text-primary transition-colors">
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <div className="w-8 h-8 rounded-full overflow-hidden border border-outline-variant/30">
            <img
              alt="User profile avatar"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuABjDGQgs5Yl8BgzRVkVBffqSo16_1mdrVJf_voJKega4vLbMwp26rbgMq-wI_PzlzuHnp4kfUMSI0dVYbiqkJHAQTkReqsB3xLcGnHrSIozEkEE6EycmUztD26dTQ33GYgZvu57iqxHF_U_OGq5uLAY8B8dGgwE1KlE8I2_CQbNtMFMGG0ZQ0z1fBB6JYmsBRzpB0JpWyGOx1Iq_smAQwSj8y_YsTy-_GGaygnmDLZziPDVf9YcTqtBmxIi9Eb093xmBBfzaCcjNc"
            />
          </div>
        </div>
      </div>
    </nav>
  );
}