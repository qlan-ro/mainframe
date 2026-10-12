use super::*;

impl TunnelManager {
    pub fn get_url(&self, label: &str) -> Option<String> {
        self.tunnels.get(label).map(|t| t.url.clone())
    }

    pub async fn verify(&self, label: &str) -> bool {
        if let Some(cached) = self.verified_at.get(label)
            && cached.checked_at.elapsed() < self.config.verify_cache_ttl
        {
            tracing::debug!(label, reachable = cached.reachable, "verify cache hit");
            return cached.reachable;
        }

        let url = {
            let Some(tunnel) = self.tunnels.get(label) else {
                return false;
            };
            if !tunnel.ready {
                return false;
            }
            tunnel.url.clone()
        };

        let client = match &self.client {
            Ok(client) => client,
            Err(err) => {
                tracing::debug!(label, error = ?err, "verify failed: network error");
                return false;
            }
        };
        match client
            .get(format!("{url}/health"))
            .timeout(self.config.verify_timeout)
            .send()
            .await
        {
            Ok(res) => self.verify_response(label, res).await,
            Err(err) => {
                tracing::debug!(label, error = ?err, "verify failed: network error");
                false
            }
        }
    }

    async fn verify_response(&self, label: &str, res: reqwest::Response) -> bool {
        if !res.status().is_success() {
            tracing::debug!(
                label,
                status = res.status().as_u16(),
                "verify failed: non-200"
            );
            self.verified_at.insert(
                label.to_string(),
                VerifyResult {
                    reachable: false,
                    checked_at: Instant::now(),
                },
            );
            return false;
        }
        match res.json::<HealthBody>().await {
            Ok(body) => {
                let reachable = body.status.as_deref() == Some("ok");
                tracing::debug!(label, reachable, "verify result");
                self.verified_at.insert(
                    label.to_string(),
                    VerifyResult {
                        reachable,
                        checked_at: Instant::now(),
                    },
                );
                reachable
            }
            // Non-JSON body → false, and (unlike the non-200 path) no cache
            // write.
            Err(err) => {
                tracing::debug!(label, error = ?err, "verify failed: network error");
                false
            }
        }
    }

    /// Poll system DNS until the tunnel hostname resolves. Returns `true` on
    /// resolution, `false` on timeout.
    pub(super) async fn wait_for_dns(&self, url: &str) -> bool {
        let hostname = extract_hostname(url);
        let start = Instant::now();
        loop {
            if start.elapsed() > self.config.dns_timeout {
                return false;
            }
            if let Ok(mut addrs) = tokio::net::lookup_host((hostname.as_str(), 443u16)).await
                && addrs.next().is_some()
            {
                return true;
            }
            sleep(self.config.dns_poll).await;
        }
    }

    pub(super) fn broadcast(&self, event: DaemonEvent) {
        (self.broadcast)(event);
    }
}
