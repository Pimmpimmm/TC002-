#include "Painter.h"
#include <base/base.h>

Painter& Painter::getInstance() {
    static Painter instance;
    return instance;
}

Painter::Painter() {
}

Painter::~Painter() {
}

void Painter::drawRect(Surface& surface, int x, int y, int width, int height, 
                       const Color& color, bool filled) {
    if (width <= 0 || height <= 0) {
        return;
    }

    int surfaceWidth  = surface.getWidth();
    int surfaceHeight = surface.getHeight();

    if (filled) {
        for (int dy = 0; dy < height; dy++) {
            for (int dx = 0; dx < width; dx++) {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < surfaceWidth && py >= 0 && py < surfaceHeight) {
                    surface.setPixel(px, py, color);
                }
            }
        }
    } else {
        for (int dx = 0; dx < width; dx++) {
            int px = x + dx;
            if (px >= 0 && px < surfaceWidth) {
                if (y >= 0 && y < surfaceHeight)
                    surface.setPixel(px, y, color);
                int py2 = y + height - 1;
                if (py2 != y && py2 >= 0 && py2 < surfaceHeight)
                    surface.setPixel(px, py2, color);
            }
        }
        for (int dy = 1; dy < height - 1; dy++) {
            int py = y + dy;
            if (py >= 0 && py < surfaceHeight) {
                if (x >= 0 && x < surfaceWidth)
                    surface.setPixel(x, py, color);
                int px2 = x + width - 1;
                if (px2 != x && px2 >= 0 && px2 < surfaceWidth)
                    surface.setPixel(px2, py, color);
            }
        }
    }
}

void Painter::drawPixel(Surface& surface, int x, int y, const Color& color) {
    if (x >= 0 && x < surface.getWidth() && y >= 0 && y < surface.getHeight()) {
        surface.setPixel(x, y, color);
    }
}

void Painter::drawLine(Surface& surface, int x0, int y0, int x1, int y1, const Color& color) {
    int dx = x1 > x0 ? x1 - x0 : x0 - x1;
    int dy = y1 > y0 ? y1 - y0 : y0 - y1;
    int sx = x0 < x1 ? 1 : -1;
    int sy = y0 < y1 ? 1 : -1;
    int err = dx - dy;

    while (true) {
        drawPixel(surface, x0, y0, color);
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 <  dx) { err += dx; y0 += sy; }
    }
}

void Painter::drawCircle(Surface& surface, int cx, int cy, int cr,
                          const Color& color, bool filled) {
    if (cr < 0) return;

    if (cr == 0) {
        drawPixel(surface, cx, cy, color);
        return;
    }

    if (filled) {
        drawLine(surface, cx - cr, cy, cx + cr, cy, color);
        int x = cr;
        int y = 0;
        int p = 1 - cr;
        while (x > y) {
            y++;
            if (p <= 0) {
                p = p + 2 * y + 1;
            } else {
                x--;
                p = p + 2 * y - 2 * x + 1;
            }
            if (x < y) break;
            drawLine(surface, cx - x, cy - y, cx + x, cy - y, color);
            drawLine(surface, cx - x, cy + y, cx + x, cy + y, color);
            if (x != y) {
                drawLine(surface, cx - y, cy - x, cx + y, cy - x, color);
                drawLine(surface, cx - y, cy + x, cx + y, cy + x, color);
            }
        }
    } else {
        int x = cr;
        int y = 0;
        int p = 1 - cr;
        drawPixel(surface, cx + cr, cy,      color);
        drawPixel(surface, cx - cr, cy,      color);
        drawPixel(surface, cx,      cy + cr, color);
        drawPixel(surface, cx,      cy - cr, color);
        while (x > y) {
            y++;
            if (p <= 0) {
                p = p + 2 * y + 1;
            } else {
                x--;
                p = p + 2 * y - 2 * x + 1;
            }
            if (x < y) break;
            drawPixel(surface, cx + x, cy - y, color);
            drawPixel(surface, cx - x, cy - y, color);
            drawPixel(surface, cx + x, cy + y, color);
            drawPixel(surface, cx - x, cy + y, color);
            if (x != y) {
                drawPixel(surface, cx + y, cy - x, color);
                drawPixel(surface, cx - y, cy - x, color);
                drawPixel(surface, cx + y, cy + x, color);
                drawPixel(surface, cx - y, cy + x, color);
            }
        }
    }
}

void Painter::drawBitmap(Surface& surface, int x, int y, int w, int h,
                          const std::vector<uint32_t>& data) {
    if (w <= 0 || h <= 0) return;
    if (static_cast<int>(data.size()) < w * h) return;

    for (int py = 0; py < h; py++) {
        for (int px = 0; px < w; px++) {
            uint32_t rgb = data[py * w + px];
            Color c(
                (rgb >> 16) & 0xFF,
                (rgb >>  8) & 0xFF,
                 rgb        & 0xFF
            );
            drawPixel(surface, x + px, y + py, c);
        }
    }
}

void Painter::drawChar(Surface& surface, int x, int y, char c, const Color& color) {
    if (c < TomThumb.first || c > TomThumb.last) {
        return;
    }

    GFXglyph* glyph = &TomThumb.glyph[c - TomThumb.first];
    const uint8_t* bitmap = &TomThumb.bitmap[glyph->bitmapOffset];
    
    int width = glyph->width;
    int height = glyph->height;
    int xOffset = glyph->xOffset;
    int yOffset = glyph->yOffset;

    for (int gy = 0; gy < height; gy++) {
        uint8_t rowBits = bitmap[gy];
        for (int gx = 0; gx < width; gx++) {
            if (rowBits & (0x80 >> gx)) {
                int px = x + xOffset + gx;
                int py = y + yOffset + gy;
                drawPixel(surface, px, py, color);
            }
        }
    }
}

void Painter::drawText(Surface& surface, int x, int y, const std::string& text, 
                       const Color& color, int letterSpacing) {
    int currentX = x;
    
    for (size_t i = 0; i < text.length(); i++) {
        char c = text[i];
        
        drawChar(surface, currentX, y, c, color);
        
        if (c >= TomThumb.first && c <= TomThumb.last) {
            GFXglyph* glyph = &TomThumb.glyph[c - TomThumb.first];
            currentX += glyph->xAdvance + letterSpacing;
        } else {
            currentX += 2 + letterSpacing;
        }
    }
}

int Painter::getTextWidth(const std::string& text, int letterSpacing) {
    int totalWidth = 0;
    
    for (size_t i = 0; i < text.length(); i++) {
        char c = text[i];
        
        if (c >= TomThumb.first && c <= TomThumb.last) {
            GFXglyph* glyph = &TomThumb.glyph[c - TomThumb.first];
            totalWidth += glyph->xAdvance;
        } else {
            totalWidth += 2;
        }

        if (i < text.length() - 1) {
            totalWidth += letterSpacing;
        }
    }
    
    return totalWidth;
}

