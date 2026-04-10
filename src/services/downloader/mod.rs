pub mod types;
pub mod utils;
pub mod zip;

use once_cell::sync::Lazy;
use reqwest::Response;
use tokio::task::JoinSet;

use crate::config;

use self::types::{Data, DownloadResult, SpooledTempAsyncRead};
use self::utils::response_to_tempfile;
use self::zip::{unzip, zip};

use super::book_library::get_remote_book;
use super::book_library::types::BookWithRemote;

pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);

pub async fn download<'a>(
    book_id: &'a u32,
    book_file_type: &'a str,
    source_config: &'a config::SourceConfig,
) -> Option<(Response, bool)> {
    let basic_url = &source_config.url;
    let proxy = &source_config.proxy;

    let url = if book_file_type == "fb2" || book_file_type == "epub" || book_file_type == "mobi" {
        format!("{basic_url}/b/{book_id}/{book_file_type}")
    } else {
        format!("{basic_url}/b/{book_id}/download")
    };

    let client = match proxy {
        Some(v) => {
            let proxy_data = reqwest::Proxy::http(v);
            reqwest::Client::builder()
                .proxy(proxy_data.unwrap())
                .build()
                .unwrap()
        }
        None => CLIENT.clone(),
    };

    let response = client.get(url).send().await;

    let response = match response {
        Ok(v) => v,
        Err(_) => return None,
    };

    let response = match response.error_for_status() {
        Ok(v) => v,
        Err(_) => return None,
    };

    let headers = response.headers();
    let content_type = match headers.get("Content-Type") {
        Some(v) => v.to_str().unwrap_or(""),
        None => "",
    };

    if book_file_type.to_lowercase() == "html" && content_type.contains("text/html") {
        return Some((response, false));
    }

    if content_type.contains("text/html") {
        return None;
    }

    let is_zip = content_type.contains("application/zip");

    Some((response, is_zip))
}

fn get_filename_from_response(response: &reqwest::Response, default_id: u32, file_type: &str, final_need_zip: bool) -> (String, String) {
    let fallback_ext = if final_need_zip { format!("{}.zip", file_type) } else { file_type.to_string() };
    let mut filename = format!("book_{}.{}", default_id, fallback_ext);
    
    if let Some(disp) = response.headers().get("content-disposition") {
        if let Ok(disp_str) = disp.to_str() {
            if let Some(idx) = disp_str.find("filename=") {
                let f = &disp_str[idx + 9..];
                let f = f.trim_matches(|c| c == '"' || c == '\'');
                filename = f.to_string();
            }
        }
    }

    // Attempt to make an ascii version
    let ascii_filename = filename.replace(|c: char| !c.is_ascii(), "");
    let ascii_filename = if ascii_filename.is_empty() { format!("book_{}.{}", default_id, fallback_ext) } else { ascii_filename };

    (filename, ascii_filename)
}

pub async fn download_chain(
    book: BookWithRemote,
    file_type: String,
    source_config: config::SourceConfig,
) -> Option<DownloadResult> {
    let final_need_zip = file_type == "fb2zip";

    let (mut response, is_zip) = match download(&book.remote_id, &file_type, &source_config).await
    {
        Some(v) => v,
        None => return None,
    };

    let (mut filename, mut filename_ascii) = get_filename_from_response(&response, book.remote_id, &file_type, final_need_zip);

    // Для HTML в zip — отдаём как есть
    if is_zip && file_type.to_lowercase() == "html" {
        let data_size: usize = response
            .headers()
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        return Some(DownloadResult::new(
            Data::Response(response),
            filename,
            filename_ascii,
            data_size,
        ));
    }

    // Не zip, не нужен zip → отдаём напрямую
    if !is_zip && !final_need_zip {
        let data_size: usize = response
            .headers()
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        return Some(DownloadResult::new(
            Data::Response(response),
            filename,
            filename_ascii,
            data_size,
        ));
    }

    // Zip → распаковываем
    let (unzipped_temp_file, data_size) = {
        let temp_file_to_unzip_result = response_to_tempfile(&mut response).await;
        let temp_file_to_unzip = match temp_file_to_unzip_result {
            Some(v) => v.0,
            None => return None,
        };

        match unzip(temp_file_to_unzip, "fb2") {
            Some(v) => v,
            None => return None,
        }
    };

    let (mut clean_file, data_size) = (unzipped_temp_file, data_size);

    if !final_need_zip {
        let t = SpooledTempAsyncRead::new(clean_file);
        // We know it was unzipped, so we should ensure the extension reflects that
        filename = filename.replace(".zip", "");
        filename_ascii = filename_ascii.replace(".zip", "");

        return Some(DownloadResult::new(
            Data::SpooledTempAsyncRead(t),
            filename,
            filename_ascii,
            data_size,
        ));
    }

    // Нужен fb2.zip → запаковываем
    let zip_filename_internal = filename.replace(".zip", ""); 
    match zip(&mut clean_file, &zip_filename_internal) {
        Some((t_file, data_size)) => {
            let t = SpooledTempAsyncRead::new(t_file);
            if !filename.ends_with(".zip") {
                filename = format!("{}.zip", filename);
                filename_ascii = format!("{}.zip", filename_ascii);
            }

            Some(DownloadResult::new(
                Data::SpooledTempAsyncRead(t),
                filename,
                filename_ascii,
                data_size,
            ))
        }
        None => None,
    }
}

pub async fn start_download_futures(
    book: &BookWithRemote,
    file_type: &str,
) -> Option<DownloadResult> {
    let mut tasks = JoinSet::new();

    for source_config in &config::CONFIG.fl_sources {
        tasks.spawn(download_chain(
            book.clone(),
            file_type.to_string(),
            source_config.clone(),
        ));
    }

    while let Some(task_result) = tasks.join_next().await {
        if let Ok(Some(task_result)) = task_result {
            return Some(task_result);
        }
    }

    None
}

pub async fn book_download(
    source_id: u32,
    remote_id: u32,
    file_type: &str,
) -> Result<Option<DownloadResult>, Box<dyn std::error::Error + Send + Sync>> {
    let book = match get_remote_book(source_id, remote_id).await {
        Ok(v) => v,
        Err(err) => return Err(err),
    };

    match start_download_futures(&book, file_type).await {
        Some(v) => Ok(Some(v)),
        None => Ok(None),
    }
}
