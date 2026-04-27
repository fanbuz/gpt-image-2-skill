use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use clap::{ArgAction, Args, Subcommand, ValueEnum};
use image::{DynamicImage, ImageReader, Rgba, RgbaImage};
use serde::Serialize;
use serde_json::{Value, json};

use super::*;

const DEFAULT_MATTE_COLOR: &str = "#00ff00";
const DEFAULT_CHROMA_THRESHOLD: f32 = 28.0;
const DEFAULT_CHROMA_SOFTNESS: f32 = 34.0;
const TRANSPARENT_ALPHA_MAX: u8 = 5;
const NONTRANSPARENT_ALPHA_MIN: u8 = 20;
const MIN_TRANSPARENT_RATIO: f64 = 0.005;

#[derive(Args, Debug)]
pub struct TransparentCommand {
    #[command(subcommand)]
    pub transparent_command: TransparentSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum TransparentSubcommand {
    Generate(TransparentGenerateArgs),
    Extract(TransparentExtractArgs),
    Verify(TransparentVerifyArgs),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub enum TransparentMethod {
    Auto,
    Chroma,
    Dual,
}

impl TransparentMethod {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Chroma => "chroma",
            Self::Dual => "dual",
        }
    }
}

#[derive(Args, Debug, Clone)]
pub struct TransparentGenerateArgs {
    #[arg(long)]
    pub prompt: String,
    #[arg(long)]
    pub out: String,
    #[arg(short = 'm', long)]
    pub model: Option<String>,
    #[arg(long, default_value = DEFAULT_INSTRUCTIONS)]
    pub instructions: String,
    #[arg(long, value_parser = parse_image_size)]
    pub size: Option<String>,
    #[arg(long, value_enum)]
    pub quality: Option<Quality>,
    #[arg(long = "compression", value_parser = clap::value_parser!(u8).range(0..=100))]
    pub output_compression: Option<u8>,
    #[arg(long, value_enum)]
    pub moderation: Option<Moderation>,
    #[arg(long, value_enum, default_value = "auto")]
    pub method: TransparentMethod,
    #[arg(long, default_value = DEFAULT_MATTE_COLOR)]
    pub matte_color: String,
    #[arg(long)]
    pub source_prompt: Option<String>,
    #[arg(long)]
    pub source_out: Option<String>,
    #[arg(long)]
    pub report_dir: Option<String>,
    #[arg(long, action = ArgAction::SetTrue)]
    pub keep_sources: bool,
    #[arg(long, default_value_t = DEFAULT_CHROMA_THRESHOLD)]
    pub threshold: f32,
    #[arg(long, default_value_t = DEFAULT_CHROMA_SOFTNESS)]
    pub softness: f32,
}

#[derive(Args, Debug, Clone)]
pub struct TransparentExtractArgs {
    #[arg(long)]
    pub input: Option<String>,
    #[arg(long = "dark-image")]
    pub dark_image: Option<String>,
    #[arg(long = "light-image")]
    pub light_image: Option<String>,
    #[arg(long)]
    pub out: String,
    #[arg(long, value_enum, default_value = "auto")]
    pub method: TransparentMethod,
    #[arg(long)]
    pub matte_color: Option<String>,
    #[arg(long, default_value_t = DEFAULT_CHROMA_THRESHOLD)]
    pub threshold: f32,
    #[arg(long, default_value_t = DEFAULT_CHROMA_SOFTNESS)]
    pub softness: f32,
    #[arg(long, action = ArgAction::SetTrue)]
    pub strict: bool,
}

#[derive(Args, Debug, Clone)]
pub struct TransparentVerifyArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long, action = ArgAction::SetTrue)]
    pub strict: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AlphaBoundingBox {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize)]
struct TransparentVerification {
    path: String,
    width: u32,
    height: u32,
    color_type: String,
    input_has_alpha: bool,
    alpha_min: u8,
    alpha_max: u8,
    transparent_pixels: u64,
    partial_pixels: u64,
    opaque_pixels: u64,
    nontransparent_pixels: u64,
    transparent_ratio: f64,
    partial_ratio: f64,
    opaque_ratio: f64,
    edge_nontransparent_pixels: u64,
    edge_nontransparent_ratio: f64,
    bbox: Option<AlphaBoundingBox>,
    passed: bool,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ExtractionReport {
    method: String,
    inputs: Value,
    output: Value,
    matte_color: Option<String>,
    threshold: Option<f32>,
    softness: Option<f32>,
}

pub(super) fn run_transparent_command(
    cli: &Cli,
    command: &TransparentCommand,
) -> Result<CommandOutcome, AppError> {
    match &command.transparent_command {
        TransparentSubcommand::Generate(args) => run_transparent_generate(cli, args),
        TransparentSubcommand::Extract(args) => run_transparent_extract(args),
        TransparentSubcommand::Verify(args) => run_transparent_verify(args),
    }
}

fn run_transparent_generate(
    cli: &Cli,
    args: &TransparentGenerateArgs,
) -> Result<CommandOutcome, AppError> {
    let method = match args.method {
        TransparentMethod::Auto | TransparentMethod::Chroma => TransparentMethod::Chroma,
        TransparentMethod::Dual => {
            return Err(AppError::new(
                "unsupported_option",
                "transparent generate does not generate aligned dual-background sources. Generate the source pair explicitly, then call transparent extract --method dual.",
            ));
        }
    };
    let matte_color = parse_matte_color(&args.matte_color)?;
    let selection = select_image_provider(cli)?;
    let output_path = normalize_png_output_path(Path::new(&args.out));
    let (source_path, temp_dir) = source_output_path(args)?;
    let source_prompt = args
        .source_prompt
        .clone()
        .unwrap_or_else(|| controlled_matte_prompt(&args.prompt, matte_color));
    let shared = SharedImageArgs {
        prompt: source_prompt.clone(),
        out: source_path.display().to_string(),
        model: args.model.clone(),
        instructions: args.instructions.clone(),
        background: Background::Opaque,
        size: args.size.clone(),
        quality: args.quality,
        output_format: Some(OutputFormat::Png),
        output_compression: args.output_compression,
        n: None,
        moderation: args.moderation,
    };
    validate_provider_specific_image_args(&selection, &shared, None, None)?;
    let source_generation = generate_source_image(cli, &selection, &shared)?;
    let generated_source_path = output_files_from_payload(&source_generation)
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| source_path.clone());
    let extraction = extract_chroma_file(
        &generated_source_path,
        &output_path,
        Some(matte_color),
        args.threshold,
        args.softness,
    )?;
    let verification = verify_transparent_file(&output_path)?;
    if !verification.passed {
        return Err(verification_failed_error(&verification).with_detail(json!({
            "source": generated_source_path.display().to_string(),
            "output": output_path.display().to_string(),
            "verification": verification,
        })));
    }
    if !args.keep_sources
        && args.source_out.is_none()
        && args.report_dir.is_none()
        && let Some(temp_dir) = temp_dir
    {
        let _ = fs::remove_dir_all(temp_dir);
    }
    let history_job_id = record_history_job(
        "transparent generate",
        &selection.resolved,
        "completed",
        Some(&output_path),
        json!({
            "prompt": args.prompt,
            "source_prompt": source_prompt,
            "method": method.as_str(),
            "provider_selection": selection.payload(),
            "source_output": source_generation.get("output").cloned().unwrap_or(Value::Null),
            "output": output_file_value(&output_path),
            "extraction": extraction,
            "verification": verification,
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "transparent generate",
            "provider": selection.resolved,
            "provider_selection": selection.payload(),
            "request": {
                "prompt": args.prompt,
                "source_prompt": source_prompt,
                "method": method.as_str(),
                "matte_color": color_to_hex(matte_color),
                "size": args.size,
                "quality": args.quality.map(Quality::as_str),
                "format": "png",
            },
            "source": {
                "path": generated_source_path.display().to_string(),
                "kept": args.keep_sources || args.source_out.is_some() || args.report_dir.is_some(),
                "generation": source_generation,
            },
            "extraction": extraction,
            "verification": verification,
            "output": output_file_value(&output_path),
            "history": {
                "job_id": history_job_id,
            }
        }),
        exit_status: 0,
    })
}

fn generate_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    if matches!(selection.kind, ProviderKind::OpenAi) {
        generate_openai_source_image(cli, selection, shared)
    } else {
        generate_codex_source_image(cli, selection, shared)
    }
}

fn generate_openai_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    let auth_state = load_openai_auth_state_for(cli, selection)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_openai_image_body(
        "generate",
        &shared.prompt,
        &resolved_model,
        &[],
        None,
        None,
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        shared.n,
        shared.moderation,
    );
    let endpoint = build_openai_operation_endpoint(&selection.api_base, "generate")?;
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (payload, retry_count) =
        execute_openai_with_retry(&mut logger, &selection.resolved, |logger| {
            request_openai_images_once(&endpoint, &auth_state, &body, logger)
        })?;
    let (image_bytes_list, revised_prompts) = decode_openai_images(&payload)?;
    if image_bytes_list.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include a generated image.",
        ));
    }
    let saved_files = save_images(Path::new(&shared.out), &image_bytes_list)?;
    emit_progress_event(
        &mut logger,
        "openai",
        "source_saved",
        "Controlled transparent-PNG source image saved.",
        "completed",
        Some(50),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    Ok(json!({
        "provider": selection.resolved,
        "provider_selection": selection.payload(),
        "request": summarize_image_request_options("openai", "generate", &resolved_model, shared, 0, false, None),
        "response": {
            "created": payload.get("created"),
            "background": payload.get("background"),
            "output_format": payload.get("output_format"),
            "quality": payload.get("quality"),
            "size": payload.get("size"),
            "image_count": image_bytes_list.len(),
            "revised_prompts": revised_prompts.into_iter().flatten().collect::<Vec<_>>(),
        },
        "output": normalize_saved_output(&saved_files),
        "retry": {
            "count": retry_count,
            "max_retries": DEFAULT_RETRY_COUNT,
        },
        "events": {
            "count": logger.seq,
        }
    }))
}

fn generate_codex_source_image(
    cli: &Cli,
    selection: &ProviderSelection,
    shared: &SharedImageArgs,
) -> Result<Value, AppError> {
    let mut auth_state = load_codex_auth_state_for(cli, selection)?;
    let resolved_model = shared
        .model
        .clone()
        .unwrap_or_else(|| selection.default_model.clone());
    let body = build_codex_image_body(
        &shared.prompt,
        &resolved_model,
        &shared.instructions,
        &[],
        shared.background,
        shared.size.as_deref(),
        shared.quality,
        shared.output_format,
        shared.output_compression,
        "generate",
    );
    let mut logger = JsonEventLogger::new(cli.json_events);
    let (outcome, auth_refreshed, retry_count) = request_codex_with_retry(
        &selection.codex_endpoint,
        &mut auth_state,
        &body,
        &mut logger,
    )?;
    let output_items = outcome
        .get("output_items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let image_items = extract_codex_image_items(&output_items);
    if image_items.is_empty() {
        return Err(AppError::new(
            "missing_image_result",
            "The response did not include an image_generation_call result.",
        ));
    }
    let image_bytes_list: Vec<Vec<u8>> = image_items
        .iter()
        .filter_map(|item| item.get("result").and_then(Value::as_str))
        .map(decode_base64_bytes)
        .collect::<Result<_, _>>()?;
    let saved_files = save_images(Path::new(&shared.out), &image_bytes_list)?;
    emit_progress_event(
        &mut logger,
        "codex",
        "source_saved",
        "Controlled transparent-PNG source image saved.",
        "completed",
        Some(50),
        json!({
            "file_count": saved_files.len(),
            "output": normalize_saved_output(&saved_files),
        }),
    );
    let response_meta = outcome
        .get("response")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let revised_prompts = image_items
        .iter()
        .filter_map(|item| item.get("revised_prompt").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Ok(json!({
        "provider": selection.resolved,
        "provider_selection": selection.payload(),
        "request": summarize_image_request_options("codex", "generate", &resolved_model, shared, 0, false, None),
        "response": {
            "response_id": response_meta.get("id"),
            "model": response_meta.get("model"),
            "service_tier": response_meta.get("service_tier"),
            "status": response_meta.get("status"),
            "image_count": image_items.len(),
            "item_ids": image_items.iter().map(|item| item.get("id").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
            "revised_prompts": revised_prompts,
        },
        "output": normalize_saved_output(&saved_files),
        "retry": {
            "count": retry_count,
            "max_retries": DEFAULT_RETRY_COUNT,
        },
        "auth": {
            "source": match &auth_state.persistence {
                CodexAuthPersistence::AuthFile => "auth.json",
                CodexAuthPersistence::ConfigProvider { .. } => "config",
                CodexAuthPersistence::SessionOnly => "session",
            },
            "auth_file": auth_state.auth_path.display().to_string(),
            "account_id": auth_state.account_id,
            "refreshed": auth_refreshed,
        },
        "events": {
            "count": logger.seq,
        }
    }))
}

fn run_transparent_extract(args: &TransparentExtractArgs) -> Result<CommandOutcome, AppError> {
    let output_path = normalize_png_output_path(Path::new(&args.out));
    let method = resolve_extract_method(
        args.method,
        args.input.as_deref(),
        args.dark_image.as_deref(),
        args.light_image.as_deref(),
    )?;
    let extraction = match method {
        TransparentMethod::Chroma => {
            let input = args.input.as_deref().ok_or_else(|| {
                AppError::new(
                    "invalid_argument",
                    "transparent extract --method chroma requires --input.",
                )
            })?;
            let matte = args
                .matte_color
                .as_deref()
                .map(parse_matte_color)
                .transpose()?;
            extract_chroma_file(
                Path::new(input),
                &output_path,
                matte,
                args.threshold,
                args.softness,
            )?
        }
        TransparentMethod::Dual => {
            let dark = args.dark_image.as_deref().ok_or_else(|| {
                AppError::new(
                    "invalid_argument",
                    "transparent extract --method dual requires --dark-image.",
                )
            })?;
            let light = args.light_image.as_deref().ok_or_else(|| {
                AppError::new(
                    "invalid_argument",
                    "transparent extract --method dual requires --light-image.",
                )
            })?;
            extract_dual_file(Path::new(dark), Path::new(light), &output_path)?
        }
        TransparentMethod::Auto => unreachable!("auto is resolved before extraction"),
    };
    let verification = verify_transparent_file(&output_path)?;
    if args.strict && !verification.passed {
        return Err(verification_failed_error(&verification).with_detail(json!({
            "output": output_path.display().to_string(),
            "verification": verification,
        })));
    }
    let history_job_id = record_history_job(
        "transparent extract",
        "local",
        "completed",
        Some(&output_path),
        json!({
            "method": method.as_str(),
            "output": output_file_value(&output_path),
            "extraction": extraction,
            "verification": verification,
        }),
    )
    .ok();
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "transparent extract",
            "method": method.as_str(),
            "extraction": extraction,
            "verification": verification,
            "output": output_file_value(&output_path),
            "history": {
                "job_id": history_job_id,
            }
        }),
        exit_status: 0,
    })
}

fn run_transparent_verify(args: &TransparentVerifyArgs) -> Result<CommandOutcome, AppError> {
    let verification = verify_transparent_file(Path::new(&args.input))?;
    if args.strict && !verification.passed {
        return Err(verification_failed_error(&verification));
    }
    Ok(CommandOutcome {
        payload: json!({
            "ok": true,
            "command": "transparent verify",
            "passed": verification.passed,
            "verification": verification,
        }),
        exit_status: 0,
    })
}

fn resolve_extract_method(
    requested: TransparentMethod,
    input: Option<&str>,
    dark_image: Option<&str>,
    light_image: Option<&str>,
) -> Result<TransparentMethod, AppError> {
    match requested {
        TransparentMethod::Auto => {
            if dark_image.is_some() || light_image.is_some() {
                if dark_image.is_some() && light_image.is_some() {
                    Ok(TransparentMethod::Dual)
                } else {
                    Err(AppError::new(
                        "invalid_argument",
                        "Dual extraction needs both --dark-image and --light-image.",
                    ))
                }
            } else if input.is_some() {
                Ok(TransparentMethod::Chroma)
            } else {
                Err(AppError::new(
                    "invalid_argument",
                    "transparent extract needs --input or a --dark-image/--light-image pair.",
                ))
            }
        }
        TransparentMethod::Chroma => Ok(TransparentMethod::Chroma),
        TransparentMethod::Dual => Ok(TransparentMethod::Dual),
    }
}

fn extract_chroma_file(
    input_path: &Path,
    output_path: &Path,
    matte_color: Option<[u8; 3]>,
    threshold: f32,
    softness: f32,
) -> Result<ExtractionReport, AppError> {
    let image = read_image(input_path)?.to_rgba8();
    let matte = matte_color.unwrap_or_else(|| estimate_matte_color(&image));
    let output = extract_chroma(&image, matte, threshold, softness);
    save_rgba_png(output_path, &output)?;
    Ok(ExtractionReport {
        method: "chroma".to_string(),
        inputs: json!({
            "input": input_path.display().to_string(),
        }),
        output: output_file_value(output_path),
        matte_color: Some(color_to_hex(matte)),
        threshold: Some(threshold),
        softness: Some(softness),
    })
}

fn extract_dual_file(
    dark_path: &Path,
    light_path: &Path,
    output_path: &Path,
) -> Result<ExtractionReport, AppError> {
    let dark = read_image(dark_path)?.to_rgba8();
    let light = read_image(light_path)?.to_rgba8();
    if dark.dimensions() != light.dimensions() {
        return Err(AppError::new(
            "transparent_input_mismatch",
            "Dual-background images must have identical dimensions.",
        )
        .with_detail(json!({
            "dark_image": dark_path.display().to_string(),
            "light_image": light_path.display().to_string(),
            "dark_size": {"width": dark.width(), "height": dark.height()},
            "light_size": {"width": light.width(), "height": light.height()},
        })));
    }
    let output = extract_dual(&dark, &light);
    save_rgba_png(output_path, &output)?;
    Ok(ExtractionReport {
        method: "dual".to_string(),
        inputs: json!({
            "dark_image": dark_path.display().to_string(),
            "light_image": light_path.display().to_string(),
        }),
        output: output_file_value(output_path),
        matte_color: None,
        threshold: None,
        softness: None,
    })
}

fn extract_chroma(image: &RgbaImage, matte: [u8; 3], threshold: f32, softness: f32) -> RgbaImage {
    let low = threshold.max(0.0);
    let high = (threshold + softness.max(1.0)).max(low + 1.0);
    let mut output = RgbaImage::new(image.width(), image.height());
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let source = image.get_pixel(x, y).0;
        let distance = color_distance([source[0], source[1], source[2]], matte);
        let t = ((distance - low) / (high - low)).clamp(0.0, 1.0);
        let smoothed = t * t * (3.0 - 2.0 * t);
        let alpha = (smoothed * 255.0).round().clamp(0.0, 255.0) as u8;
        *pixel = decontaminate_pixel(source, matte, alpha);
    }
    output
}

fn extract_dual(dark: &RgbaImage, light: &RgbaImage) -> RgbaImage {
    let mut output = RgbaImage::new(dark.width(), dark.height());
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let d = dark.get_pixel(x, y).0;
        let l = light.get_pixel(x, y).0;
        let delta = (0..3)
            .map(|channel| (l[channel] as f32 - d[channel] as f32).clamp(0.0, 255.0))
            .sum::<f32>()
            / 3.0;
        let alpha_f = (1.0 - delta / 255.0).clamp(0.0, 1.0);
        let alpha = (alpha_f * 255.0).round().clamp(0.0, 255.0) as u8;
        if alpha <= TRANSPARENT_ALPHA_MAX {
            *pixel = Rgba([0, 0, 0, 0]);
        } else {
            let mut out = [0u8; 4];
            for channel in 0..3 {
                out[channel] = (d[channel] as f32 / alpha_f.max(0.001))
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
            out[3] = alpha;
            *pixel = Rgba(out);
        }
    }
    output
}

fn verify_transparent_file(path: &Path) -> Result<TransparentVerification, AppError> {
    let decoded = read_image(path)?;
    let color_type = format!("{:?}", decoded.color());
    let input_has_alpha = decoded.color().has_alpha();
    let rgba = decoded.to_rgba8();
    let width = rgba.width();
    let height = rgba.height();
    let total = u64::from(width) * u64::from(height);
    let mut alpha_min = u8::MAX;
    let mut alpha_max = u8::MIN;
    let mut transparent_pixels = 0u64;
    let mut partial_pixels = 0u64;
    let mut opaque_pixels = 0u64;
    let mut nontransparent_pixels = 0u64;
    let mut edge_nontransparent_pixels = 0u64;
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0u32;
    let mut max_y = 0u32;

    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = pixel.0[3];
        alpha_min = alpha_min.min(alpha);
        alpha_max = alpha_max.max(alpha);
        if alpha <= TRANSPARENT_ALPHA_MAX {
            transparent_pixels += 1;
        } else {
            nontransparent_pixels += 1;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
            if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
                edge_nontransparent_pixels += 1;
            }
            if alpha >= 250 {
                opaque_pixels += 1;
            } else {
                partial_pixels += 1;
            }
        }
    }

    let transparent_ratio = ratio(transparent_pixels, total);
    let partial_ratio = ratio(partial_pixels, total);
    let opaque_ratio = ratio(opaque_pixels, total);
    let edge_pixels = if width == 0 || height == 0 {
        0
    } else if width == 1 || height == 1 {
        total
    } else {
        u64::from(width) * 2 + u64::from(height.saturating_sub(2)) * 2
    };
    let edge_nontransparent_ratio = ratio(edge_nontransparent_pixels, edge_pixels);
    let bbox = if nontransparent_pixels == 0 {
        None
    } else {
        Some(AlphaBoundingBox {
            x: min_x,
            y: min_y,
            width: max_x - min_x + 1,
            height: max_y - min_y + 1,
        })
    };
    let mut warnings = Vec::new();
    if edge_nontransparent_ratio > 0.15 {
        warnings.push(
            "nontransparent pixels reach the image edge; consider adding margin before extraction"
                .to_string(),
        );
    }
    if partial_pixels == 0 {
        warnings.push("no semi-transparent pixels detected".to_string());
    }
    let passed = input_has_alpha
        && nontransparent_pixels > 0
        && alpha_min <= TRANSPARENT_ALPHA_MAX
        && alpha_max >= NONTRANSPARENT_ALPHA_MIN
        && transparent_ratio >= MIN_TRANSPARENT_RATIO;

    Ok(TransparentVerification {
        path: path.display().to_string(),
        width,
        height,
        color_type,
        input_has_alpha,
        alpha_min,
        alpha_max,
        transparent_pixels,
        partial_pixels,
        opaque_pixels,
        nontransparent_pixels,
        transparent_ratio,
        partial_ratio,
        opaque_ratio,
        edge_nontransparent_pixels,
        edge_nontransparent_ratio,
        bbox,
        passed,
        warnings,
    })
}

fn read_image(path: &Path) -> Result<DynamicImage, AppError> {
    ImageReader::open(path)
        .map_err(|error| {
            AppError::new("image_read_failed", "Unable to open image file.").with_detail(json!({
                "path": path.display().to_string(),
                "error": error.to_string(),
            }))
        })?
        .with_guessed_format()
        .map_err(|error| {
            AppError::new("image_read_failed", "Unable to detect image format.").with_detail(
                json!({
                    "path": path.display().to_string(),
                    "error": error.to_string(),
                }),
            )
        })?
        .decode()
        .map_err(|error| {
            AppError::new("image_decode_failed", "Unable to decode image file.").with_detail(
                json!({
                    "path": path.display().to_string(),
                    "error": error.to_string(),
                }),
            )
        })
}

fn save_rgba_png(path: &Path, image: &RgbaImage) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new("output_write_failed", "Unable to create output directory.").with_detail(
                json!({ "error": error.to_string(), "path": parent.display().to_string() }),
            )
        })?;
    }
    image.save(path).map_err(|error| {
        AppError::new("output_write_failed", "Unable to write transparent PNG.")
            .with_detail(json!({ "error": error.to_string(), "path": path.display().to_string() }))
    })
}

fn decontaminate_pixel(source: [u8; 4], matte: [u8; 3], alpha: u8) -> Rgba<u8> {
    if alpha <= TRANSPARENT_ALPHA_MAX {
        return Rgba([0, 0, 0, 0]);
    }
    let alpha_f = f32::from(alpha) / 255.0;
    let mut output = [0u8; 4];
    for channel in 0..3 {
        output[channel] = ((f32::from(source[channel])
            - f32::from(matte[channel]) * (1.0 - alpha_f))
            / alpha_f.max(0.001))
        .round()
        .clamp(0.0, 255.0) as u8;
    }
    output[3] = alpha.min(source[3]);
    Rgba(output)
}

fn estimate_matte_color(image: &RgbaImage) -> [u8; 3] {
    let width = image.width();
    let height = image.height();
    let sample = width.min(height).clamp(1, 32);
    let mut red = Vec::new();
    let mut green = Vec::new();
    let mut blue = Vec::new();
    for y in 0..sample {
        for x in 0..sample {
            push_rgb(image.get_pixel(x, y).0, &mut red, &mut green, &mut blue);
            push_rgb(
                image.get_pixel(width - 1 - x, y).0,
                &mut red,
                &mut green,
                &mut blue,
            );
            push_rgb(
                image.get_pixel(x, height - 1 - y).0,
                &mut red,
                &mut green,
                &mut blue,
            );
            push_rgb(
                image.get_pixel(width - 1 - x, height - 1 - y).0,
                &mut red,
                &mut green,
                &mut blue,
            );
        }
    }
    [median(red), median(green), median(blue)]
}

fn push_rgb(pixel: [u8; 4], red: &mut Vec<u8>, green: &mut Vec<u8>, blue: &mut Vec<u8>) {
    red.push(pixel[0]);
    green.push(pixel[1]);
    blue.push(pixel[2]);
}

fn median(mut values: Vec<u8>) -> u8 {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    values[values.len() / 2]
}

fn color_distance(a: [u8; 3], b: [u8; 3]) -> f32 {
    let r = f32::from(a[0]) - f32::from(b[0]);
    let g = f32::from(a[1]) - f32::from(b[1]);
    let b = f32::from(a[2]) - f32::from(b[2]);
    (r * r + g * g + b * b).sqrt()
}

fn parse_matte_color(value: &str) -> Result<[u8; 3], AppError> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "black" => return Ok([0, 0, 0]),
        "white" => return Ok([255, 255, 255]),
        "green" | "chroma-green" => return Ok([0, 255, 0]),
        "magenta" => return Ok([255, 0, 255]),
        "cyan" => return Ok([0, 255, 255]),
        "blue" => return Ok([0, 0, 255]),
        _ => {}
    }
    let hex = normalized.strip_prefix('#').unwrap_or(&normalized);
    if hex.len() != 6 {
        return Err(AppError::new(
            "invalid_argument",
            "Matte color must be a named color or #RRGGBB.",
        )
        .with_detail(json!({ "value": value })));
    }
    let red = u8::from_str_radix(&hex[0..2], 16).map_err(|_| invalid_color_error(value))?;
    let green = u8::from_str_radix(&hex[2..4], 16).map_err(|_| invalid_color_error(value))?;
    let blue = u8::from_str_radix(&hex[4..6], 16).map_err(|_| invalid_color_error(value))?;
    Ok([red, green, blue])
}

fn invalid_color_error(value: &str) -> AppError {
    AppError::new(
        "invalid_argument",
        "Matte color must be a named color or #RRGGBB.",
    )
    .with_detail(json!({ "value": value }))
}

fn color_to_hex(color: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

fn output_file_value(path: &Path) -> Value {
    let bytes = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    json!({
        "path": path.display().to_string(),
        "bytes": bytes,
        "files": [{
            "index": 0,
            "path": path.display().to_string(),
            "bytes": bytes,
        }]
    })
}

fn normalize_png_output_path(path: &Path) -> PathBuf {
    if path.extension().is_none() {
        path.with_extension("png")
    } else {
        path.to_path_buf()
    }
}

fn source_output_path(
    args: &TransparentGenerateArgs,
) -> Result<(PathBuf, Option<PathBuf>), AppError> {
    if let Some(source_out) = &args.source_out {
        return Ok((normalize_png_output_path(Path::new(source_out)), None));
    }
    if let Some(report_dir) = &args.report_dir {
        let dir = PathBuf::from(report_dir);
        return Ok((dir.join("source.png"), None));
    }
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "gpt-image-2-transparent-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&temp_dir).map_err(|error| {
        AppError::new(
            "output_write_failed",
            "Unable to create temporary source directory.",
        )
        .with_detail(json!({ "path": temp_dir.display().to_string(), "error": error.to_string() }))
    })?;
    Ok((temp_dir.join("source.png"), Some(temp_dir)))
}

fn controlled_matte_prompt(prompt: &str, matte: [u8; 3]) -> String {
    format!(
        "{prompt}\n\nExtraction setup: render exactly one isolated asset, centered with a clear margin, on a perfectly flat uniform matte background of pure {matte}. Do not use gradients, texture, vignette, shadows, reflections, contact shadows, scenery, props, labels, frames, or background-colored details. Keep the full subject visible and separated from the matte.",
        matte = color_to_hex(matte)
    )
}

fn ratio(count: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        count as f64 / total as f64
    }
}

fn verification_failed_error(verification: &TransparentVerification) -> AppError {
    AppError::new(
        "transparent_verification_failed",
        "Transparent PNG verification failed.",
    )
    .with_detail(json!({ "verification": verification }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chroma_extraction_creates_real_alpha() {
        let temp_dir = tempfile::tempdir().unwrap();
        let input_path = temp_dir.path().join("input.png");
        let output_path = temp_dir.path().join("output.png");
        let mut input = RgbaImage::from_pixel(64, 64, Rgba([0, 255, 0, 255]));
        for y in 18..46 {
            for x in 18..46 {
                input.put_pixel(x, y, Rgba([220, 20, 20, 255]));
            }
        }
        input.save(&input_path).unwrap();

        extract_chroma_file(
            &input_path,
            &output_path,
            Some([0, 255, 0]),
            DEFAULT_CHROMA_THRESHOLD,
            DEFAULT_CHROMA_SOFTNESS,
        )
        .unwrap();
        let verification = verify_transparent_file(&output_path).unwrap();
        assert!(verification.passed);
        assert_eq!(verification.alpha_min, 0);
        assert_eq!(verification.alpha_max, 255);
    }

    #[test]
    fn dual_extraction_recovers_semi_transparent_alpha() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dark_path = temp_dir.path().join("dark.png");
        let light_path = temp_dir.path().join("light.png");
        let output_path = temp_dir.path().join("output.png");
        let mut dark = RgbaImage::from_pixel(16, 16, Rgba([0, 0, 0, 255]));
        let mut light = RgbaImage::from_pixel(16, 16, Rgba([255, 255, 255, 255]));
        let alpha = 0.5f32;
        for y in 4..12 {
            for x in 4..12 {
                let fg = [200f32, 40f32, 20f32];
                dark.put_pixel(
                    x,
                    y,
                    Rgba([
                        (fg[0] * alpha).round() as u8,
                        (fg[1] * alpha).round() as u8,
                        (fg[2] * alpha).round() as u8,
                        255,
                    ]),
                );
                light.put_pixel(
                    x,
                    y,
                    Rgba([
                        (fg[0] * alpha + 255.0 * (1.0 - alpha)).round() as u8,
                        (fg[1] * alpha + 255.0 * (1.0 - alpha)).round() as u8,
                        (fg[2] * alpha + 255.0 * (1.0 - alpha)).round() as u8,
                        255,
                    ]),
                );
            }
        }
        dark.save(&dark_path).unwrap();
        light.save(&light_path).unwrap();

        extract_dual_file(&dark_path, &light_path, &output_path).unwrap();
        let output = read_image(&output_path).unwrap().to_rgba8();
        let center = output.get_pixel(8, 8).0;
        assert!((i16::from(center[3]) - 128).abs() <= 2);
        let verification = verify_transparent_file(&output_path).unwrap();
        assert!(verification.passed);
        assert!(verification.partial_pixels > 0);
    }

    #[test]
    fn verification_rejects_fully_opaque_png() {
        let temp_dir = tempfile::tempdir().unwrap();
        let input_path = temp_dir.path().join("opaque.png");
        RgbaImage::from_pixel(16, 16, Rgba([10, 20, 30, 255]))
            .save(&input_path)
            .unwrap();
        let verification = verify_transparent_file(&input_path).unwrap();
        assert!(!verification.passed);
        assert_eq!(verification.transparent_pixels, 0);
    }
}
