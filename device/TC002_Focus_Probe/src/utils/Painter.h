#ifndef PAINTER_H_
#define PAINTER_H_

#include "Surface.h"
#include <string>
#include <vector>
#include "Fonts/TomThumb.h"
class Painter {
public:
    static Painter& getInstance();
    
    /**
     * 画矩形
     * @param surface 绘制表面
     * @param x 左上角x坐标
     * @param y 左上角y坐标
     * @param width 矩形宽度
     * @param height 矩形高度
     * @param color 颜色
     * @param filled 是否填充(true=填充, false=只画单像素边框)
     */
    void drawRect(Surface& surface, int x, int y, int width, int height, 
                  const Color& color, bool filled = true);
    

    /**
     * 画点
     * @param surface 绘制表面
     * @param x x坐标
     * @param y y坐标
     * @param color 颜色
     */
    void drawPixel(Surface& surface, int x, int y, const Color& color);

    /**
     * 画线 (Bresenham)
     * @param surface 绘制表面
     * @param x0 起点x
     * @param y0 起点y
     * @param x1 终点x
     * @param y1 终点y
     * @param color 颜色
     */
    void drawLine(Surface& surface, int x0, int y0, int x1, int y1, const Color& color);

    /**
     * 画圆
     * @param surface 绘制表面
     * @param cx 圆心坐标x
     * @param cy 圆心坐标y
     * @param cr 圆半径
     * @param color 颜色
     * @param filled 是否填充(true=填充, false=只画边框)
     */
    void drawCircle(Surface& surface, int cx, int cy, int cr, 
                    const Color& color, bool filled = false);

    /**
     * 绘制 RGB888 bitmap
     * @param surface 绘制表面
     * @param x 左上角x坐标
     * @param y 左上角y坐标
     * @param w bitmap宽度
     * @param h bitmap高度
     * @param data RGB888 像素数组，每元素为 uint32_t，格式 0x00RRGGBB，长度 = w*h
     */
    void drawBitmap(Surface& surface, int x, int y, int w, int h,
                    const std::vector<uint32_t>& data);

    /**
     * 绘制图片
     * @param surface 绘制表面
     * @param imagePath 图片路径
     * @param x 左上角x坐标
     * @param y 左上角y坐标
     */
    void drawImage(Surface& surface, const std::string& imagePath, int x, int y);
    
    /**
     * 在指定区域内居中绘制图片
     * @param surface 绘制表面
     * @param imagePath 图片路径
     * @param rectX 区域左上角x坐标
     * @param rectY 区域左上角y坐标
     * @param rectWidth 区域宽度
     * @param rectHeight 区域高度
     */
    void drawImageCentered(Surface& surface, const std::string& imagePath, 
                          int rectX, int rectY, int rectWidth, int rectHeight);
    
    /**
     * 绘制单个字符 (使用 TomThumb 字体)
     * @param surface 绘制表面
     * @param x 左上角x坐标
     * @param y 左上角y坐标（基线位置）
     * @param c 要绘制的字符
     * @param color 颜色
     */
    void drawChar(Surface& surface, int x, int y, char c, const Color& color);
    
    /**
     * 绘制字符串 (使用 TomThumb 字体)
     * @param surface 绘制表面
     * @param x 左上角x坐标
     * @param y 左上角y坐标（基线位置）
     * @param text 要绘制的字符串
     * @param color 颜色
     * @param letterSpacing 字符间距（默认 1 像素）
     */
    void drawText(Surface& surface, int x, int y, const std::string& text, 
                  const Color& color, int letterSpacing = 1);
    
    /**
     * 获取字符串的宽度（像素）
     * @param text 字符串
     * @param letterSpacing 字符间距
     * @return 字符串总宽度
     */
    int getTextWidth(const std::string& text, int letterSpacing = 1);

private:
    Painter();
    ~Painter();
    Painter(const Painter&) = delete;
    Painter& operator=(const Painter&) = delete;
};

#endif
