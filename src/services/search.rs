use scraper::{Html, Selector};
use serde::Serialize;
use crate::config::CONFIG;
use crate::services::downloader::CLIENT;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Book,
    Author,
    Series,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchResult {
    pub id: u32,
    pub title: String,
    pub author: String,
    pub item_type: ItemType,
}

fn build_client(source: &crate::config::SourceConfig) -> reqwest::Client {
    match &source.proxy {
        Some(p) => reqwest::Client::builder()
            .proxy(reqwest::Proxy::http(p.as_str()).unwrap())
            .build()
            .unwrap_or_else(|_| CLIENT.clone()),
        None => CLIENT.clone(),
    }
}

pub async fn search_books(query: &str) -> Vec<SearchResult> {
    for source in &CONFIG.fl_sources {
        let client = build_client(source);
        let search_url = format!("{}/booksearch", source.url);

        let response = match client
            .get(&search_url)
            .query(&[("ask", query)])
            .send()
            .await
        {
            Ok(res) => res,
            Err(e) => {
                tracing::warn!("Search error on {}: {}", source.url, e);
                continue;
            }
        };

        let final_url = response.url().clone();

        // Флибуста редиректит на /b/ID если найдена ровно одна книга
        if final_url.path().starts_with("/b/") {
            let path = final_url.path();
            // /b/ — ровно 3 символа, поэтому [3..]
            let id_str: String = path[3..].chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(id) = id_str.parse::<u32>() {
                let html = response.text().await.unwrap_or_default();
                let doc = Html::parse_document(&html);
                return vec![SearchResult {
                    id,
                    title: extract_book_title(&doc, id),
                    author: extract_first_author(&doc),
                    item_type: ItemType::Book,
                }];
            }
        }

        let html = match response.text().await {
            Ok(s) => s,
            Err(_) => continue,
        };

        let results = parse_search_results(&html);
        if !results.is_empty() {
            return results;
        }
    }

    vec![]
}

pub async fn get_author_books(id: u32) -> Vec<SearchResult> {
    fetch_and_parse("/a/", id).await
}

pub async fn get_series_books(id: u32) -> Vec<SearchResult> {
    // Флибуста использует /sequence/ID для страниц серий
    fetch_and_parse("/sequence/", id).await
}

async fn fetch_and_parse(prefix: &str, id: u32) -> Vec<SearchResult> {
    for source in &CONFIG.fl_sources {
        let client = build_client(source);
        let url = format!("{}{}{}", source.url, prefix, id);

        let response = match client.get(&url).send().await {
            Ok(res) => res,
            Err(_) => continue,
        };

        let html = response.text().await.unwrap_or_default();
        let results = parse_search_results(&html);
        if !results.is_empty() {
            return results;
        }
    }

    vec![]
}

fn extract_book_title(doc: &Html, id: u32) -> String {
    let sel = Selector::parse("h1.title").unwrap();
    doc.select(&sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("Book #{}", id))
}

fn extract_first_author(doc: &Html) -> String {
    let sel = Selector::parse("a[href^='/a/']").unwrap();
    doc.select(&sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_default()
}

fn parse_search_results(html: &str) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let document = Html::parse_document(html);

    // Флибуста кладёт контент в #main
    let main_sel = Selector::parse("#main").unwrap();
    let root = document.root_element();
    let main_node = document.select(&main_sel).next().unwrap_or(root);

    let link_sel = Selector::parse("a[href]").unwrap();
    let book_sel = Selector::parse("a[href*='/b/']").unwrap();

    let mut seen = std::collections::HashSet::new();

    for el in main_node.select(&link_sel) {
        let href = match el.value().attr("href") {
            Some(h) => h,
            None => continue,
        };

        let (item_type, prefix, raw_id) = if let Some(idx) = href.find("/b/") {
            (ItemType::Book, "b", &href[idx + 3..])
        } else if let Some(idx) = href.find("/a/") {
            (ItemType::Author, "a", &href[idx + 3..])
        } else if let Some(idx) = href.find("/sequence/") {
            (ItemType::Series, "s", &href[idx + 10..])
        } else {
            continue;
        };

        let id_str: String = raw_id.chars().take_while(|c| c.is_ascii_digit()).collect();
        let id = match id_str.parse::<u32>() {
            Ok(v) if v > 0 => v,
            _ => continue,
        };

        let key = format!("{}:{}", prefix, id);
        if !seen.insert(key) {
            continue;
        }

        let mut title = el.text().collect::<String>().trim().to_string();

        // Пропускаем технические ссылки
        if title.is_empty() || title == "читать" || title == "скачать" || title == "все форматы" {
            continue;
        }

        // Для авторов: пропускаем ссылку на автора внутри li-элемента книги
        // (книжные записи содержат и ссылку на книгу, и на автора)
        if item_type == ItemType::Author {
            if let Some(parent) = el.parent().and_then(scraper::ElementRef::wrap) {
                if parent.value().name() == "li"
                    && parent.select(&book_sel).next().is_some()
                {
                    continue;
                }
            }
        }

        // Для серий — добавляем счётчик книг если есть
        if item_type == ItemType::Series {
            if let Some(next) = el.next_sibling() {
                if let Some(text) = next.value().as_text() {
                    let extra = text.trim();
                    if extra.contains("книг") {
                        title = format!("{} {}", title, extra);
                    }
                }
            }
        }

        let author = if item_type == ItemType::Book {
            if let Some(parent) = el.parent().and_then(scraper::ElementRef::wrap) {
                let author_sel = Selector::parse("a[href*='/a/']").unwrap();
                parent
                    .select(&author_sel)
                    .map(|a| a.text().collect::<String>().trim().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        results.push(SearchResult { id, title, author, item_type });

        if results.len() >= 120 {
            break;
        }
    }

    results
}
