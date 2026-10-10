import { state } from '@askrjs/askr';
import { currentAuth, currentRoute } from '@askrjs/askr/router';
import { LogOutIcon, MoonIcon, SunIcon } from '@askrjs/lucide';
import {
  Block,
  Button,
  Container,
  Header,
  Navbar,
  NavBrand,
  NavGroup,
} from '@askrjs/themes/components';
import { ThemeScope, ThemeToggle } from '@askrjs/themes/theme';
import { OverlayHost } from '@askrjs/ui';

import { ComplianceBrand } from '../components/compliance-brand.js';
import { signOut } from '../features/authentication/auth.js';

export function PageLayout({ children }: { children?: unknown }) {
  const [signOutPending, setSignOutPending] = state(false);
  const [signOutError, setSignOutError] = state<string | null>(null);
  const route = currentRoute();
  const isAuthenticationRoute =
    route.path === '/login' || route.path === '/auth/callback';

  async function handleSignOut() {
    if (signOutPending()) return;
    setSignOutPending(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('We could not confirm sign-out. Please try again.');
    } finally {
      setSignOutPending(false);
    }
  }

  return (
    <ThemeScope defaultTheme="light" storageKey="bdgrz-compliance-theme">
      <OverlayHost>
        <Block minHeight="screen" direction="column">
          {!isAuthenticationRoute ? (
            <Header sticky>
              <Container size="xl" paddingY="xs">
                <Navbar aria-label="Site header">
                  <NavBrand>
                    <ComplianceBrand />
                  </NavBrand>
                  <NavGroup align="end">
                    <ThemeToggle
                      aria-label="Toggle theme"
                      variant="ghost"
                      size="icon"
                      lightIcon={<SunIcon size={16} aria-hidden="true" />}
                      darkIcon={<MoonIcon size={16} aria-hidden="true" />}
                    />
                    {currentAuth().authenticated ? (
                      <Button
                        aria-label="Sign out"
                        variant="ghost"
                        disabled={signOutPending()}
                        onPress={() => void handleSignOut()}
                      >
                        <LogOutIcon size={16} aria-hidden="true" />
                        <Block as="span" hide={{ base: true, sm: false }}>
                          Sign out
                        </Block>
                      </Button>
                    ) : null}
                  </NavGroup>
                </Navbar>
                {signOutError() ? <p role="alert">{signOutError()}</p> : null}
              </Container>
            </Header>
          ) : null}
          {children}
        </Block>
      </OverlayHost>
    </ThemeScope>
  );
}
