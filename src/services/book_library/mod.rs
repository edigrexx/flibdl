pub mod types;

/// Создаёт BookWithRemote напрямую из source_id и remote_id
/// Раньше это обращалось к внешнему BOOK_LIBRARY API.
/// Теперь работает автономно — метаданные минимальные,
/// реальное имя файла приходит из Content-Disposition ответа Флибусты.
pub async fn get_remote_book(
    _source_id: u32,
    remote_id: u32,
) -> Result<types::BookWithRemote, Box<dyn std::error::Error + Send + Sync>> {
    Ok(types::BookWithRemote {
        id: remote_id,
        remote_id,
        title: format!("book_{}", remote_id),
        lang: "ru".to_string(),
        file_type: "fb2".to_string(),
        uploaded: String::new(),
        authors: vec![],
    })
}

pub async fn get_book(
    book_id: u32,
) -> Result<types::BookWithRemote, Box<dyn std::error::Error + Send + Sync>> {
    get_remote_book(1, book_id).await
}
