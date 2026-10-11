use std::future::{Future, IntoFuture};
use std::net::SocketAddr;
use std::time::Duration;

pub async fn serve(
    listener: tokio::net::TcpListener,
    app: axum::Router,
    signal: impl Future<Output = ()>,
    cleanup: impl Future<Output = ()>,
) -> std::io::Result<()> {
    let (stop, stopped) = tokio::sync::oneshot::channel();
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async { stopped.await.unwrap_or_default() })
    .into_future();
    finish(server, signal, stop, cleanup).await
}

async fn finish(
    server: impl Future<Output = std::io::Result<()>>,
    signal: impl Future<Output = ()>,
    stop: tokio::sync::oneshot::Sender<()>,
    cleanup: impl Future<Output = ()>,
) -> std::io::Result<()> {
    tokio::pin!(server);
    tokio::select! {
        result = &mut server => {
            cleanup.await;
            result
        }
        () = signal => {
            if stop.send(()).is_err() {
                tracing::warn!("HTTP shutdown receiver closed");
            }
            let (drained, ()) = tokio::join!(
                tokio::time::timeout(Duration::from_secs(1), &mut server),
                cleanup,
            );
            match drained {
                Ok(result) => result,
                Err(_) => {
                    tracing::warn!("HTTP shutdown drain timed out");
                    Ok(())
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
