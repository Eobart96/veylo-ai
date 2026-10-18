//! Capture only the selected crop. Encode PNG without running local OCR.
pub fn encode_bgra(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width < 8 || height < 8 || width > 8192 || height > 8192 || u64::from(width) * u64::from(height) > 16_000_000 || pixels.len() as u64 != u64::from(width) * u64::from(height) * 4 {
        return Err("Некорректный размер снимка.".into());
    }
    encode_pixels(pixels, width, height)
}
fn encode_pixels(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    encode_pixels_mode(pixels, width, height, false)
}
fn encode_pixels_mode(pixels: &[u8], width: u32, height: u32, preview: bool) -> Result<Vec<u8>, String> {
    let mut rgba = pixels.to_vec();
    for pixel in rgba.chunks_exact_mut(4) { pixel.swap(0, 2); pixel[3] = 255; }
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, width, height);
        encoder.set_color(png::ColorType::Rgba); encoder.set_depth(png::BitDepth::Eight);
        // Full-monitor PNG is only a local preview: prioritize latency over size.
        // The uploaded crop retains the regular compression and original pixels.
        if preview { encoder.set_compression(png::Compression::Fastest); encoder.set_filter(png::Filter::NoFilter); }
        let mut writer = encoder.write_header().map_err(|_| "Не удалось подготовить PNG.".to_owned())?;
        writer.write_image_data(&rgba).map_err(|_| "Не удалось закодировать снимок.".to_owned())?;
    }
    Ok(output)
}

pub struct Frame { pub pixels: Vec<u8>, pub width: u32, pub height: u32 }
impl Frame {
    pub fn data_url(&self) -> Result<String, String> {
        use base64::Engine;
        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(encode_pixels_mode(&self.pixels, self.width, self.height, true)?)))
    }
    pub fn crop(&self, x: u32, y: u32, width: u32, height: u32) -> Result<Vec<u8>, String> {
        if x.checked_add(width).is_none_or(|right| right > self.width) || y.checked_add(height).is_none_or(|bottom| bottom > self.height) || width < 8 || height < 8 || width > 8192 || height > 8192 || u64::from(width) * u64::from(height) > 16_000_000 {
            return Err("Область вне зафиксированного кадра.".into());
        }
        let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
        for row in y..y + height {
            let offset = (row as usize * self.width as usize + x as usize) * 4;
            pixels.extend_from_slice(&self.pixels[offset..offset + width as usize * 4]);
        }
        encode_bgra(&pixels, width, height)
    }
}

#[cfg(windows)]
pub fn capture_frame(x: i32, y: i32, width: i32, height: i32, cancelled: &std::sync::atomic::AtomicBool) -> Result<Frame, String> {
    use windows::Win32::Graphics::{Gdi::*, Dwm::DwmFlush};
    if width < 8 || height < 8 || width > 8192 || height > 8192 || i64::from(width) * i64::from(height) > 16_000_000 { return Err("Монитор слишком большой для фиксации кадра. Максимум 16 млн пикселей и 8192 по стороне.".into()); }
    unsafe { let _ = DwmFlush(); }
    std::thread::sleep(std::time::Duration::from_millis(100));
    if cancelled.load(std::sync::atomic::Ordering::SeqCst) { return Err("Захват отменён.".into()); }
    let pixels = unsafe {
        let screen = GetDC(None);
        if screen.0.is_null() { return Err("Windows не разрешила захват экрана.".into()); }
        let memory = CreateCompatibleDC(Some(screen));
        if memory.0.is_null() { ReleaseDC(None, screen); return Err("Не удалось подготовить снимок.".into()); }
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() };
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(screen), &info, DIB_RGB_COLORS, &mut bits, None, 0);
        let result = match bitmap {
            Ok(bitmap) => {
                let previous = SelectObject(memory, HGDIOBJ(bitmap.0));
                let copied = if bits.is_null() || previous.0.is_null() || previous.0 as isize == -1 {
                    Err("Не удалось подготовить область снимка.".to_owned())
                } else {
                    BitBlt(memory, 0, 0, width, height, Some(screen), x, y, SRCCOPY | CAPTUREBLT)
                        .map_err(|_| "Не удалось снять область экрана. Попробуй оконный режим игры.".to_owned())
                        .map(|_| std::slice::from_raw_parts(bits as *const u8, width as usize * height as usize * 4).to_vec())
                };
                SelectObject(memory, previous); let _ = DeleteObject(HGDIOBJ(bitmap.0)); copied
            },
            Err(_) => Err("Не удалось выделить память снимка.".into()),
        };
        let _ = DeleteDC(memory); ReleaseDC(None, screen); result
    }?;
    Ok(Frame { pixels, width: width as u32, height: height as u32 })
}
#[cfg(not(windows))]
pub fn capture_frame(_: i32, _: i32, _: i32, _: i32, _: &std::sync::atomic::AtomicBool) -> Result<Frame, String> { Err("Захват экрана доступен в Windows.".into()) }

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "Synthetic 2K preview benchmark; no desktop capture or network"]
    fn synthetic_preview_benchmark() {
        use std::time::Instant;
        let (width, height) = (2560u32, 1440u32);
        let mut seed = 42u32;
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..width * height {
            seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
            pixels.extend_from_slice(&[seed as u8, (seed >> 8) as u8, (seed >> 16) as u8, 0]);
        }
        let mut old_ns = 0; let mut fast_ns = 0;
        for attempt in 0..3 {
            let mut outputs = [Vec::new(), Vec::new()];
            // Alternate order to reduce warmup bias; include base64 in both paths.
            for preview in if attempt % 2 == 0 { [false, true] } else { [true, false] } {
                use base64::Engine;
                let started = Instant::now();
                let png = super::encode_pixels_mode(&pixels, width, height, preview).unwrap();
                let encoded = base64::engine::general_purpose::STANDARD.encode(&png);
                assert!(!encoded.is_empty());
                let elapsed = started.elapsed().as_nanos();
                if preview { fast_ns += elapsed; } else { old_ns += elapsed; }
                outputs[usize::from(preview)] = png;
            }
            let decode = |png: &[u8]| {
                let mut reader = png::Decoder::new(std::io::Cursor::new(png)).read_info().unwrap();
                let mut decoded = vec![0; reader.output_buffer_size().unwrap()];
                let info = reader.next_frame(&mut decoded).unwrap();
                assert_eq!((info.width, info.height), (width, height)); decoded
            };
            assert_eq!(decode(&outputs[0]), decode(&outputs[1]), "Preview must preserve all pixels");
        }
        println!("PREVIEW_BENCH old_mean_ms={} fast_mean_ms={}", old_ns / 3_000_000, fast_ns / 3_000_000);
        assert!(fast_ns < old_ns, "Fast path did not improve preparation on this machine");
        println!("CAPTURE_PREVIEW_FASTER");
    }
    #[test]
    fn crop_uses_only_pixels_of_the_frozen_frame_and_rejects_outside_bounds() {
        let mut pixels = [1, 2, 3, 255].repeat(20 * 20);
        let target = (5 * 20 + 4) * 4; pixels[target..target + 4].copy_from_slice(&[10, 20, 30, 255]);
        let frame = super::Frame { pixels, width: 20, height: 20 };
        let cropped = frame.crop(4, 5, 8, 9).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(cropped)).read_info().unwrap();
        let mut output = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut output).unwrap();
        assert_eq!((info.width, info.height), (8, 9)); assert_eq!(&output[..4], &[30, 20, 10, 255]);
        assert!(frame.crop(15, 15, 8, 8).is_err());
        assert!(frame.crop(u32::MAX, 0, 8, 8).is_err());
        assert!(frame.data_url().unwrap().starts_with("data:image/png;base64,"));
    }
    #[test]
    fn png_preserves_dimensions_and_rgb_channels_without_desktop_capture() {
        let pixels = [20, 40, 60, 0].repeat(8 * 9);
        let png = super::encode_bgra(&pixels, 8, 9).unwrap();
        let decoder = png::Decoder::new(std::io::Cursor::new(png));
        let mut reader = decoder.read_info().unwrap();
        let mut bytes = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut bytes).unwrap();
        assert_eq!((info.width, info.height), (8, 9));
        assert_eq!(&bytes[..4], &[60, 40, 20, 255]);
        assert!(super::encode_bgra(&pixels[..10], 8, 9).is_err());
        assert!(super::encode_bgra(&[], 9000, 9000).is_err());
    }
}
