use bytes::Bytes;
use crate::config::CONFIG;
use crate::services::downloader::CLIENT;

pub async fn fetch_cover(book_id: u32) -> Option<(Bytes, String)> {
    // Папка = последние две цифры ID: 642216 → /i/16/642216/cover.jpg
    let folder = book_id % 100;

    for source in &CONFIG.fl_sources {
        let client = match &source.proxy {
            Some(p) => reqwest::Client::builder()
                .proxy(reqwest::Proxy::http(p.as_str()).unwrap())
                .build()
                .unwrap_or_else(|_| CLIENT.clone()),
            None => CLIENT.clone(),
        };

        let url = format!("{}/i/{}/{}/cover.jpg", source.url, folder, book_id);

        let response = match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };

        // Флибуста отдаёт HTML вместо картинки для книг без обложки
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !content_type.starts_with("image/") {
            continue;
        }

        if let Ok(bytes) = response.bytes().await {
            // Минимальная проверка — не пустой пиксель
            if bytes.len() > 200 {
                return Some((bytes, content_type));
            }
        }
    }

    None
}
