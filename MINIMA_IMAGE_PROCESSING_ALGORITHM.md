# MINIMA — thuật toán xử lý ảnh được trích xuất từ source

## Phạm vi và bằng chứng

Tài liệu này mô tả **chỉ những hành vi có trong source** tại `D:\IMG_RESIZE`:

- `BicubicResizeLab/ScaleAwareBicubicResizer.cs`
- `BicubicResizeLab/ImageSharpBridge.cs`
- `BicubicResizeLab/LargeImageBridge.cs`
- `BicubicResizeLab/BatchSafety.cs`
- `BicubicResizeDropTest/MainViewModel.cs`
- `BicubicResizeLab/BicubicResizeLab.csproj`

MINIMA là ứng dụng resize ảnh theo thư mục. Source không chứa crop, rotate thủ công, filter màu, sharpen, denoise, AI upscaling, hay chỉnh sửa ảnh nào khác. `AutoOrient`/`Autorot` là thao tác định hướng EXIF khi nạp ảnh, không phải một công cụ edit do người dùng chọn.

Mọi chi tiết dưới đây là trích xuất trực tiếp từ mã C#. Những phần thuộc nội bộ ImageSharp hoặc libvips mà source không định nghĩa được ghi nhận là lời gọi API, không diễn giải suy đoán.

## Đầu vào, đầu ra và giới hạn

- Input folder chỉ quét cấp hiện tại (`Directory.EnumerateFiles(input)`); không quét thư mục con.
- Phần mở rộng được nhận: `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.tif`, `.tiff`.
- GIF động và SVG không được đưa vào batch vì không thuộc danh sách extension hỗ trợ.
- Width và Height UI bị clamp trong khoảng `1..20_000`, nhưng preflight còn chặn mọi output có `width × height > 100_000_000` pixel.
- Resize là **exact-size**: output luôn được tạo theo đúng `(targetWidth, targetHeight)`. Không có crop/fit/letterbox ở đường output, vì vậy có thể làm thay đổi tỷ lệ khung hình nếu người dùng nhập W:H khác ảnh gốc.
- Kết quả của mỗi batch nằm trong thư mục mới `run-yyyyMMdd-HHmmss-fff` (UTC), không ghi đè source hoặc batch cũ.

## Chọn pipeline

Mỗi ảnh được preflight bằng `BatchSafety.TryPlan`:

1. Đọc kích thước qua `Image.Identify(path)` của ImageSharp.
2. Tính bộ nhớ đỉnh ước lượng:

   ```text
   sourcePixels      = sourceWidth × sourceHeight
   destinationPixels = destinationWidth × destinationHeight
   preWidth  = sourceWidth  > 2 × destinationWidth  ? min(sourceWidth,  2 × destinationWidth)  : sourceWidth
   preHeight = sourceHeight > 2 × destinationHeight ? min(sourceHeight, 2 × destinationHeight) : sourceHeight
   prePixels = preWidth × preHeight

   estimatedPeakBytes = sourcePixels × 36
                      + max(preWidth × sourceHeight + prePixels,
                            destinationWidth × preHeight) × 32
                      + destinationPixels × 4
   ```

3. Nếu `estimatedPeakBytes` lớn hơn một nửa `GC.GetGCMemoryInfo().TotalAvailableMemoryBytes`, ảnh dùng low-memory pipeline của libvips. Ngược lại nó dùng custom in-memory pipeline bên dưới.
4. Nếu batch có ít nhất một ảnh low-memory, toàn batch chạy tuần tự. Nếu không, số job song song là `clamp(min(4, max(1, memoryBudget / largestEstimatedPeak)), 1, 4)` với `memoryBudget = availableMemory / 2`.

## Custom in-memory pipeline (pipeline mặc định)

### 1. Decode và định hướng

`ImageSharpBridge.Load` thực hiện đúng chuỗi sau:

```csharp
Image.Load<Rgba32>(path)
decoded.Mutate(context => context.AutoOrient())
```

Sau đó từng pixel được copy vào `BicubicResizeLab.RgbaImage`, với bốn byte R, G, B, A.

### 2. Chuyển sRGB sang linear-light và premultiply alpha

Với pixel input `R8, G8, B8, A8`, source dùng:

```text
a = A8 / 255
s = channel8 / 255

srgbToLinear(s) = s / 12.92                         khi s ≤ 0.04045
                = ((s + 0.055) / 1.055) ^ 2.4       khi s > 0.04045

P = (srgbToLinear(R) × a,
     srgbToLinear(G) × a,
     srgbToLinear(B) × a,
     a)
```

Mọi phép lọc tiếp theo dùng `P`, tức RGBA linear-light đã premultiply.

### 3. Area prefilter trước khi downscale mạnh

Nếu một chiều source lớn hơn hai lần chiều output, source áp dụng area resize ở chiều đó để giảm về `2 × output` (hoặc giữ nguyên nếu nhỏ hơn):

```text
prefilterWidth  = sourceWidth  > 2 × destinationWidth  ? min(sourceWidth,  2 × destinationWidth)  : sourceWidth
prefilterHeight = sourceHeight > 2 × destinationHeight ? min(sourceHeight, 2 × destinationHeight) : sourceHeight
```

Area filter được chạy separable (ngang, rồi dọc). Ở một trục có `scale = sourceLength / destinationLength`, pixel output `d` bao phủ đoạn source:

```text
left  = d × scale
right = (d + 1) × scale
```

Mỗi source pixel `i` nhận trọng số:

```text
overlap(i) = max(0, min(right, i + 1) - max(left, i))
weight(i)  = overlap(i) / scale
```

Đây là phép average theo phần diện tích chồng lấp của pixel. Không có prefilter nếu cả hai kích thước working vẫn bằng source.

### 4. Catmull–Rom bicubic resize

Sau prefilter (nếu có), MINIMA resize bằng bicubic separable ngang rồi dọc.

Với một trục:

```text
scale = sourceLength / destinationLength
sourceCoordinate(d) = (d + 0.5) × scale - 0.5
```

Source samples được xét từ:

```text
ceil(sourceCoordinate - 2) đến floor(sourceCoordinate + 2)
```

Kernel trong mã là Catmull–Rom cubic convolution (`a = -0.5`):

```text
t = abs(sourceIndex - sourceCoordinate)

K(t) =  1.5t³ - 2.5t² + 1                  khi t ≤ 1
      -0.5t³ + 2.5t² - 4t + 2              khi 1 < t ≤ 2
       0                                    khi t > 2
```

Mỗi index source bị clamp vào `[0, sourceLength - 1]`. Các sample cùng bị clamp vào một index được cộng trọng số. Sau đó tất cả trọng số hữu hạn được chuẩn hóa:

```text
normalizedWeight(i) = combinedWeight(i) / sum(allCombinedWeights)
```

Lọc ngang trước:

```text
horizontal[y, x] = Σ source[y, mappedXIndex] × mappedXWeight
```

Rồi lọc dọc:

```text
output[y, x] = Σ horizontal[mappedYIndex, x] × mappedYWeight
```

Map index/trọng số X và Y được tạo trước một lần cho toàn ảnh output và tái sử dụng theo hàng/cột.

### 5. Unpremultiply, linear-to-sRGB và lượng tử hoá output

Sau lọc, với pixel tích lũy `(r, g, b, a)`:

```text
a' = clamp(a, 0, 1)
```

Nếu `a' < 1e-9`, output chính xác là `(0, 0, 0, 0)`.

Ngược lại, mỗi channel trước khi encode được tính:

```text
l = clamp(channel / a', 0, 1)

linearToSrgb(l) = 12.92 × l                    khi l ≤ 0.0031308
                  1.055 × l^(1 / 2.4) - 0.055  khi l > 0.0031308

channel8 = clamp(roundAwayFromZero(srgb × 255), 0, 255)
alpha8   = clamp(roundAwayFromZero(a' × 255), 0, 255)
```

## Encode của custom pipeline

`ImageSharpBridge.Save` mở file output bằng `FileMode.CreateNew`; nếu file đã tồn tại thì thao tác save lỗi thay vì ghi đè.

| Output chọn trong MINIMA | Lời gọi encoder trong source | Thiết lập xác định được từ source |
| --- | --- | --- |
| PNG | `encoded.SaveAsPng(stream)` | Không có option encoder nào khác được truyền. |
| JPEG | `BackgroundColor(White hoặc Black)` rồi `SaveAsJpeg` | `Quality = 92`; alpha bị flatten vào nền trắng mặc định hoặc nền đen. |
| WebP | `SaveAsWebp(stream)` | `Quality = 92`; source không flatten alpha trước lời gọi này. |

## Low-memory pipeline cho ảnh lớn

Khi preflight chọn `UsesStreamingPipeline`, source gọi `LargeImageBridge.Resize`, không gọi `ScaleAwareBicubicResizer`.

Chuỗi lời gọi xác định được là:

```csharp
Image.NewFromFile(inputPath, access: Access.Sequential, failOn: FailOn.Error)
source.Autorot()
oriented.Resize(
    targetWidth / (double)oriented.Width,
    kernel: Kernel.Cubic,
    vscale: targetHeight / (double)oriented.Height)
```

Sau đó:

- JPEG/WebP: libvips được truyền option `Q = 92`.
- JPEG: `Flatten([255,255,255])` hoặc `Flatten([0,0,0])` trước `WriteToFile`.
- PNG: ghi trực tiếp `resized.WriteToFile(outputPath, options)`; source không thêm encoder option cho PNG.

Source **không định nghĩa** công thức nội bộ của `NetVips.Enums.Kernel.Cubic`; do đó tài liệu này không khẳng định kernel đó đồng nhất pixel-for-pixel với Catmull–Rom custom pipeline. README source cũng nói cubic output fallback có thể khác nhẹ ở mức pixel.

## Preview — không phải output resize

Preview UI là một luồng riêng và không được ghi làm output batch:

1. `Image.Identify` lấy kích thước; preview bị bỏ qua nếu lớn hơn 24,000,000 pixel.
2. ImageSharp load ảnh, gọi `AutoOrient()`.
3. Gọi `Resize(new ResizeOptions { Size = new Size(1200, 900), Mode = ResizeMode.Max })`.
4. Lưu BMP vào `MemoryStream`, rồi đưa vào WPF `BitmapImage`.

Preview không phản ánh exact-size output và không đi qua `ScaleAwareBicubicResizer`.

## Dependencies đã pin trong source

- .NET target: `net10.0` (core) và `net10.0-windows` (WPF MINIMA).
- `SixLabors.ImageSharp` 3.1.12.
- `NetVips` 3.2.0.
- `NetVips.Native.win-x64` 8.18.6.

## Tóm tắt xác minh

Pipeline mặc định của MINIMA là: **EXIF auto-orient → sRGB-to-linear → premultiplied-alpha → conditional exact-area prefilter → separable Catmull–Rom bicubic → unpremultiply → linear-to-sRGB → encode**.

Pipeline này được thay bằng **libvips sequential cubic** chỉ khi ước lượng RAM của pipeline mặc định lớn hơn một nửa bộ nhớ khả dụng. Đây là hai implementation khác nhau theo source.
