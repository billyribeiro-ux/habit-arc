use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::{IntoResponse, Response},
    http::StatusCode,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::jwt::{verify_token, TokenType};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    token: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
) -> Response {
    // B-07: Authenticate WebSocket connection via token query param
    let user_id = match authenticate_ws(&state, query.token.as_deref()) {
        Ok(id) => id,
        Err(e) => {
            tracing::warn!("WebSocket auth failed: {}", e);
            return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
}

fn authenticate_ws(state: &AppState, token: Option<&str>) -> Result<Uuid, &'static str> {
    let token = token.ok_or("Missing token query parameter")?;
    
    let token_data = verify_token(token, &state.config)
        .map_err(|_| "Invalid or expired token")?;
    
    if token_data.claims.token_type != TokenType::Access {
        return Err("Must use access token for WebSocket");
    }
    
    Ok(token_data.claims.sub)
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: Uuid) {
    let (mut sender, mut receiver) = socket.split();

    tracing::debug!(user_id = %user_id, "WebSocket connection established");

    let mut rx = state
        .ws_tx
        .as_ref()
        .map(|tx| tx.subscribe())
        .expect("WebSocket broadcast channel not initialized");

    // Forward broadcast messages to this WebSocket client
    // TODO: Filter by user_id for per-user channels (currently broadcasts to all)
    let uid = user_id;
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            // Parse the message to check if it's for this user
            // For now, send all messages (will be filtered when per-user channels are implemented)
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg) {
                // If message has a user_id field, only send to that user
                if let Some(msg_user_id) = parsed.get("user_id").and_then(|v| v.as_str()) {
                    if msg_user_id != uid.to_string() {
                        continue; // Skip messages for other users
                    }
                }
            }
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Read messages from client (for future bidirectional features)
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    tracing::debug!(user_id = %user_id, message = %text, "WebSocket message received");
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    tracing::debug!(user_id = %user_id, "WebSocket connection closed");
}
