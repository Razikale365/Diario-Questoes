import { useState } from 'react';
import { X, Mail, Lock, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthComplete: () => void;
  onError: (message: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthComplete, onError }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!supabase) {
        onError('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
        setLoading(false);
        return;
      }

      let result;
      if (isSignUp) {
        result = await supabase.auth.signUp({ email, password });
      } else {
        result = await supabase.auth.signInWithPassword({ email, password });
      }

      if (result.error) throw result.error;

      if (isSignUp && result.data?.user?.identities?.length === 0) {
        onError('Email already registered. Try signing in instead.');
        setLoading(false);
        return;
      }

      onAuthComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      onError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 p-0 md:items-center md:p-4">
      <div className="bg-[#333333] border border-[#404040] rounded-t-3xl w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200 md:max-w-md md:rounded-2xl md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white uppercase tracking-widest">
            {isSignUp ? 'Criar Conta' : 'Login Cloud'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="seu@email.com"
                className="w-full bg-[#2d2d2d] border border-[#404040] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#84cc16] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Mínimo 6 caracteres"
                className="w-full bg-[#2d2d2d] border border-[#404040] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#84cc16] transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#84cc16] hover:bg-[#74b80e] disabled:opacity-50 disabled:cursor-not-allowed text-black font-black uppercase tracking-widest text-sm py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              isSignUp ? 'Criar Conta' : 'Entrar'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
          >
            {isSignUp ? 'Já tem conta? Entrar' : 'Não tem conta? Criar'}
          </button>
        </div>

        <p className="mt-4 text-[10px] text-gray-500 text-center">
          Seus dados são sincronizados automaticamente entre dispositivos.
        </p>
      </div>
    </div>
  );
};
