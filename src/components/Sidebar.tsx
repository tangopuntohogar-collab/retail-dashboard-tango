import React from 'react';
import {
  LayoutDashboard,
  TableProperties,
  ChevronLeft,
  Users,
  LogOut,
  Package,
} from 'lucide-react';
import { motion } from 'motion/react';

interface SidebarProps {
  activeView: 'dashboard' | 'detail' | 'stock';
  onViewChange: (view: 'dashboard' | 'detail' | 'stock') => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onViewChange,
  isCollapsed,
  onToggleCollapse,
}) => {

  return (
    <aside
      className={`flex-shrink-0 flex flex-col border-r border-border-dark bg-[#111418] h-full z-20 relative transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-80'}`}
    >
      <button
        onClick={onToggleCollapse}
        className="absolute -right-3 top-6 bg-primary text-white rounded-full p-1 shadow-lg hover:bg-blue-600 focus:outline-none z-50 border border-border-dark transition-transform duration-300"
        style={{ transform: isCollapsed ? 'rotate(180deg)' : 'none' }}
      >
        <ChevronLeft size={16} />
      </button>

      {/* Logo */}
      <div className={`p-6 pb-2 flex-shrink-0 ${isCollapsed ? 'flex justify-center' : ''}`}>
        <div className="flex items-center gap-3 mb-8">
          <div
            className="bg-center bg-no-repeat bg-cover rounded-full size-10 shrink-0 border border-slate-700"
            style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/aida-public/AB6AXuDOxoMuWiLWbn8XlRBhZ24Z68CTCLAeMQt2Fz8mLVD8BtCTSGYfZ93je1S5vyX0ZsxZZYQzz8ABlDHtyKXpTgBZqqXhGMyCRTlsL19797kMrPDLzSMFFE64whQR8F5tg40MfxPtdcuVbiFrTbPB7K7Evg_U1LEzE2qV5tLpTo4SqSg04z5Gz99VKQbglERmUJlyHIMHwdCo2kA9eYvXIjxm9X1Zon-tctxKe44g1DlOQ2ZfXWaKOHULOiRj7hQEkyZWsiSAjo7kQuQ")' }}
          />
          {!isCollapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col">
              <h1 className="text-white text-lg font-bold leading-none tracking-tight whitespace-nowrap">Retail Electro</h1>
              <p className="text-emerald-400 text-xs font-normal mt-1 whitespace-nowrap flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                Supabase · En vivo
              </p>
            </motion.div>
          )}
        </div>

        <div className="mb-6">
          {!isCollapsed && <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4 px-1">Navegación Principal</h3>}
          <nav className="flex flex-col gap-1">
            <button
              onClick={() => onViewChange('dashboard')}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer w-full ${activeView === 'dashboard' ? 'bg-primary/20 text-primary border border-primary/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              title="Tablero de Ventas"
            >
              <LayoutDashboard size={20} className="shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap">Tablero de Ventas</span>}
            </button>
            <button
              onClick={() => onViewChange('detail')}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer w-full ${activeView === 'detail' ? 'bg-primary/20 text-primary border border-primary/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              title="Detalle de Ventas"
            >
              <TableProperties size={20} className="shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap">Detalle de Ventas</span>}
            </button>
            <button
              onClick={() => onViewChange('stock')}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer w-full ${activeView === 'stock' ? 'bg-primary/20 text-primary border border-primary/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              title="Análisis de Stock"
            >
              <Package size={20} className="shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap">Análisis de Stock</span>}
            </button>
          </nav>
        </div>
      </div>

      {/* Navigation */}
      <div className={`flex-1 px-6 flex flex-col gap-2 ${isCollapsed ? 'items-center' : ''}`}>
        {!isCollapsed && <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 mt-4 px-1">Sesión</h3>}
        <button
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer w-full text-slate-400 hover:text-white hover:bg-white/5`}
          title="Mi Perfil"
        >
          <Users size={20} className="shrink-0" />
          {!isCollapsed && <span className="text-sm font-medium">Mi Perfil</span>}
        </button>
      </div>

      {/* Footer */}
      <div className="mt-auto p-4 border-t border-slate-800 bg-[#0b0e11] flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="size-9 rounded-full bg-slate-700 overflow-hidden shrink-0">
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDx8nwdKzISJRJwRbtBqpP3bP4hYlKCXk74qybs8HpnnNLv2CuqAHwLt9bjOKNSvYkIwUbiZFUpmXCyvEy3yKdh0xGeYTFo4d4aC8yV9r3c52UXk36HkkgXwyr3cjp1ttD747DtxiBBlO3Oh4qfF1C-c71hOV2JM67ozgkIdTg-tPF2uLbqXJdfwkx2y_emq2br2Fzrq8IOVP5v5uIZ885Dt3FzFZAQUABUPQ00qL8Kun06Xn2M7u2uLUzNT1sXOkDCSKqGX6yjORg"
              alt="Roberto Gomez"
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          {!isCollapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col">
              <span className="text-sm font-medium text-white whitespace-nowrap">Roberto Gomez</span>
              <span className="text-xs text-slate-500 whitespace-nowrap">Gerente de Ventas</span>
            </motion.div>
          )}
        </div>
        {!isCollapsed && (
          <button className="text-slate-400 hover:text-white">
            <LogOut size={18} />
          </button>
        )}
      </div>
    </aside>
  );
};
