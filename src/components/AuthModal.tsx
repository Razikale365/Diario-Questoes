import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Lock, Mail, X } from 'lucide-react';

export type AuthModalMode = 'sign-in' | 'sign-up' | 'forgot-password' | 'update-password';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: AuthModalMode;
  onClose: () => void;
  onAuthComplete: () => void;
  onPasswordUpdated: () => void;
  onError: (message: string) => void;
}

const modeTitle: Record<AuthModalMode, string> = {
  'sign-in': 'Login Cloud',
  'sign-up': 'Criar Conta',
  'forgot-password': 'Recuperar Senha',
  'update-password': 'Definir Nova Senha',
};

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'sign-in',
  onClose,
  onAuthComplete,
  onPasswordUpdated,
  onError,
}) => {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setPassword('');
    setPasswordConfirmation('');
    setSuccessMessage(null);
  }, [initialMode, isOpen]);

  if (!isOpen) return null;

  const changeMode = (nextMode: AuthModalMode) => {
    setMode(nextMode);
    setPassword('');
    setPasswordConfirmation('');
    setSuccessMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setSuccessMessage(null);

    try {
      const { supabase } = await import('../lib/supabase');
      if (!supabase) {
        throw new Error('Supabase não está configurado neste aparelho.');
      }

      if (mode === 'forgot-password') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;

        setSuccessMessage('Link enviado. Abra o e-mail mais recente uma única vez neste aparelho.');
        return;
      }

      if (mode === 'update-password') {
        if (password !== passwordConfirmation) {
          throw new Error('As senhas não coincidem.');
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session) {
          throw new Error('A sessão de recuperação expirou. Solicite um novo link.');
        }

        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;

        onPasswordUpdated();
        return;
      }

      const result = mode === 'sign-up'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (result.error) throw result.error;

      if (mode === 'sign-up' && result.data?.user?.identities?.length === 0) {
        throw new Error('E-mail já cadastrado. Entre na conta ou recupere a senha.');
      }

      onAuthComplete();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Falha de autenticação.');
    } finally {
      setLoading(false);
    }
  };

  const needsEmail = mode !== 'update-password';
  const needsPassword = mode !== 'forgot-password';
  const isPasswordUpdate = mode === 'update-password';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-auth-title"
        className="w-full max-w-md rounded-lg border border-[#404040] bg-[#333333] p-6 shadow-2xl animate-in zoom-in-95 duration-200 sm:p-8"
      >
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 id="cloud-auth-title" className="text-xl font-bold uppercase text-white">
            {modeTitle[mode]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {mode === 'forgot-password' && !successMessage && (
          <p className="mb-5 text-sm leading-6 text-gray-300">
            Enviaremos um link de uso único para você definir uma nova senha.
          </p>
        )}

        {mode === 'update-password' && (
          <p className="mb-5 text-sm leading-6 text-gray-300">
            A sessão de recuperação está válida. Escolha a senha que usará no PC e no celular.
          </p>
        )}

        {successMessage && (
          <div className="mb-5 flex items-start gap-3 rounded-md border border-lime-700/60 bg-lime-950/40 p-3 text-sm text-lime-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {needsEmail && !successMessage && (
            <div>
              <label htmlFor="cloud-auth-email" className="mb-2 block text-xs font-bold uppercase text-gray-400">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  id="cloud-auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  placeholder="seu@email.com"
                  className="w-full rounded-md border border-[#4a4a4a] bg-[#2d2d2d] py-3 pl-10 pr-4 text-sm text-white placeholder-gray-500 transition-colors focus:border-[#84cc16] focus:outline-none"
                />
              </div>
            </div>
          )}

          {needsPassword && (
            <div>
              <label htmlFor="cloud-auth-password" className="mb-2 block text-xs font-bold uppercase text-gray-400">
                {isPasswordUpdate ? 'Nova senha' : 'Senha'}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  id="cloud-auth-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={6}
                  autoComplete={isPasswordUpdate ? 'new-password' : mode === 'sign-in' ? 'current-password' : 'new-password'}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full rounded-md border border-[#4a4a4a] bg-[#2d2d2d] py-3 pl-10 pr-4 text-sm text-white placeholder-gray-500 transition-colors focus:border-[#84cc16] focus:outline-none"
                />
              </div>
            </div>
          )}

          {isPasswordUpdate && (
            <div>
              <label htmlFor="cloud-auth-password-confirmation" className="mb-2 block text-xs font-bold uppercase text-gray-400">
                Confirmar nova senha
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  id="cloud-auth-password-confirmation"
                  type="password"
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                  className="w-full rounded-md border border-[#4a4a4a] bg-[#2d2d2d] py-3 pl-10 pr-4 text-sm text-white placeholder-gray-500 transition-colors focus:border-[#84cc16] focus:outline-none"
                />
              </div>
            </div>
          )}

          {!successMessage && (
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#84cc16] py-3 text-sm font-black uppercase text-black transition-colors hover:bg-[#74b80e] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {!loading && mode === 'sign-in' && 'Entrar'}
              {!loading && mode === 'sign-up' && 'Criar conta'}
              {!loading && mode === 'forgot-password' && 'Enviar link'}
              {!loading && mode === 'update-password' && 'Salvar nova senha'}
            </button>
          )}
        </form>

        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          {mode === 'sign-in' && (
            <>
              <button type="button" onClick={() => changeMode('forgot-password')} className="text-sm text-lime-400 hover:text-lime-300">
                Esqueci minha senha
              </button>
              <button type="button" onClick={() => changeMode('sign-up')} className="text-sm text-purple-400 hover:text-purple-300">
                Não tem conta? Criar
              </button>
            </>
          )}
          {mode === 'sign-up' && (
            <button type="button" onClick={() => changeMode('sign-in')} className="text-sm text-purple-400 hover:text-purple-300">
              Já tem conta? Entrar
            </button>
          )}
          {mode === 'forgot-password' && (
            <button type="button" onClick={() => changeMode('sign-in')} className="text-sm text-purple-400 hover:text-purple-300">
              Voltar ao login
            </button>
          )}
          {mode === 'update-password' && (
            <button type="button" onClick={() => changeMode('forgot-password')} className="text-sm text-purple-400 hover:text-purple-300">
              Solicitar outro link
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-[10px] text-gray-500">
          Seus dados são sincronizados automaticamente entre dispositivos.
        </p>
      </div>
    </div>
  );
};
