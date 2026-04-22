import * as React from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { useAuthStore } from '@/store/auth';

interface Props {
  open: boolean;
}

export function ChangePasswordDialog({ open }: Props) {
  const changePassword = useAuthStore((s) => s.changePassword);

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    const result = await changePassword(currentPassword, newPassword);
    setIsLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      toast.success('Password updated successfully.');
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        // Prevent closing by clicking outside or pressing Escape
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Change your password</DialogTitle>
          <DialogDescription>
            This is your first login. Please set a new password before continuing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cp-current" className="text-sm font-medium">
              Current password
            </label>
            <input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cp-new" className="text-sm font-medium">
              New password
            </label>
            <input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cp-confirm" className="text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={isLoading} className="mt-1 rounded-xs">
            {isLoading && <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
