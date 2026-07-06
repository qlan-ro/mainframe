/// A logical-pixel region (DPI-independent coordinates, matching the DOM).
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// A device-pixel aligned rectangle, ready for image cropping.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Scale a logical-pixel region to device pixels using the device-pixel ratio.
pub fn scale_region(r: Region, dpr: f64) -> PixelRect {
    PixelRect {
        x: (r.x * dpr).round().max(0.0) as u32,
        y: (r.y * dpr).round().max(0.0) as u32,
        w: (r.w * dpr).round().max(0.0) as u32,
        h: (r.h * dpr).round().max(0.0) as u32,
    }
}

/// Clamp a device-pixel rect to the image bounds.
/// Off-image rects (x/y beyond image dims) collapse to zero size.
pub fn clamp_rect(r: PixelRect, img_w: u32, img_h: u32) -> PixelRect {
    if r.x >= img_w || r.y >= img_h {
        return PixelRect { x: r.x, y: r.y, w: 0, h: 0 };
    }
    PixelRect {
        x: r.x,
        y: r.y,
        w: r.w.min(img_w - r.x),
        h: r.h.min(img_h - r.y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_region_by_dpr() {
        // logical region (10,20,30,40) at DPR 2 → device region (20,40,60,80)
        let r = scale_region(Region { x: 10.0, y: 20.0, w: 30.0, h: 40.0 }, 2.0);
        assert_eq!(r, PixelRect { x: 20, y: 40, w: 60, h: 80 });
    }

    #[test]
    fn clamps_region_to_image_bounds() {
        // region overflows the 100x100 image → clamped
        let r = clamp_rect(PixelRect { x: 90, y: 90, w: 50, h: 50 }, 100, 100);
        assert_eq!(r, PixelRect { x: 90, y: 90, w: 10, h: 10 });
    }

    #[test]
    fn zero_or_negative_region_yields_empty() {
        let r = clamp_rect(PixelRect { x: 200, y: 200, w: 10, h: 10 }, 100, 100);
        assert_eq!(r.w, 0);
        assert_eq!(r.h, 0);
    }
}
