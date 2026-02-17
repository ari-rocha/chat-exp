#[tokio::main]
async fn main() {
    chat_server::app::run().await;
}
