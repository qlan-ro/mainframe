/**
 * useDnsReload — cloudflared answers with a URL before its edge DNS resolves,
 * so a URL tab that loaded early is showing a 404 until it reloads. Bump the
 * nonce exactly once, when DNS verifies after the tab already loaded (#281 D11).
 */
import { useEffect, useRef, useState } from 'react';
import type { UrlTabTarget } from './resolve-url-target';

export function useDnsReload({
  targetKind,
  dnsVerified,
}: {
  targetKind: UrlTabTarget['kind'];
  dnsVerified: boolean;
}): number {
  const [reloadNonce, setReloadNonce] = useState(0);
  const loadedBeforeDnsRef = useRef(false);

  useEffect(() => {
    if (targetKind !== 'tunnelled') {
      loadedBeforeDnsRef.current = false;
      return;
    }
    if (!dnsVerified) {
      loadedBeforeDnsRef.current = true;
      return;
    }
    if (loadedBeforeDnsRef.current) {
      loadedBeforeDnsRef.current = false;
      setReloadNonce((n) => n + 1);
    }
  }, [targetKind, dnsVerified]);

  return reloadNonce;
}
