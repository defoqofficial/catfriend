const fs = require('fs');
const path = require('path');

function createSvg(pixels, width, height, scale = 2) {
    const w = width * scale;
    const h = height * scale;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const color = pixels[y][x];
            if (color && color !== ' ') {
                svg += `  <rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="${color}" />\n`;
            }
        }
    }
    svg += `</svg>`;
    return svg;
}

const c_ = ' '; // transparent
const cB = '#000000'; // black outline
const cW = '#FFFFFF'; // white
const cC = '#8B4513'; // coffee brown
const cM = '#D2B48C'; // mug color (tan/beige)
const cP = '#FF69B4'; // pink (yarn)
const cG = '#32CD32'; // green (plant)
const cD = '#808080'; // dark grey (mouse)
const cF = '#FFA500'; // orange (fish)

// 1. Coffee Cup
const coffeePixels = [
    [c_,c_,c_,cW,c_,c_,cW,c_,c_,c_,c_,c_],
    [c_,c_,c_,c_,cW,cW,c_,c_,c_,c_,c_,c_],
    [c_,c_,cB,cB,cB,cB,cB,cB,c_,c_,c_,c_],
    [c_,cB,cM,cM,cM,cM,cM,cM,cB,c_,c_,c_],
    [c_,cB,cM,cC,cC,cC,cC,cM,cB,cB,c_,c_],
    [c_,cB,cM,cC,cC,cC,cC,cM,cB,cM,cB,c_],
    [c_,cB,cM,cM,cM,cM,cM,cM,cB,cM,cB,c_],
    [c_,cB,cM,cM,cM,cM,cM,cM,cB,cB,c_,c_],
    [c_,c_,cB,cM,cM,cM,cM,cB,c_,c_,c_,c_],
    [c_,c_,cB,cB,cB,cB,cB,cB,c_,c_,c_,c_],
];

// 2. Fish
const fishPixels = [
    [c_,c_,c_,c_,c_,c_,c_,cB,cB,c_,c_,c_],
    [c_,c_,c_,c_,cB,cB,cB,cF,cF,cB,c_,c_],
    [cB,c_,c_,cB,cF,cF,cF,cF,cF,cF,cB,c_],
    [cB,cF,cB,cF,cF,cF,cF,cF,cF,cB,cW,cB],
    [cB,cF,cF,cF,cF,cF,cF,cF,cF,cB,cB,cB],
    [cB,cF,cB,cF,cF,cF,cF,cF,cF,cF,cB,c_],
    [cB,c_,c_,cB,cF,cF,cF,cF,cF,cB,c_,c_],
    [c_,c_,c_,c_,cB,cB,cB,cB,cB,c_,c_,c_],
];

// 3. Yarn Ball
const yarnPixels = [
    [c_,c_,c_,cB,cB,cB,cB,cB,c_,c_,c_,c_],
    [c_,c_,cB,cP,cP,cB,cP,cP,cB,c_,c_,c_],
    [c_,cB,cP,cP,cB,cP,cP,cP,cP,cB,c_,c_],
    [c_,cB,cP,cB,cP,cP,cP,cB,cP,cB,c_,c_],
    [cB,cP,cP,cP,cP,cP,cB,cP,cP,cB,c_,c_],
    [cB,cP,cB,cP,cP,cB,cP,cP,cP,cB,cB,cB],
    [c_,cB,cP,cB,cB,cP,cP,cP,cB,cP,cP,cB],
    [c_,c_,cB,cP,cP,cP,cP,cB,c_,cB,cB,c_],
    [c_,c_,c_,cB,cB,cB,cB,c_,c_,c_,c_,c_],
];

// 4. Toy Mouse
const mousePixels = [
    [c_,c_,c_,c_,c_,c_,cB,cB,c_,c_,c_,c_],
    [c_,c_,c_,c_,c_,cB,cD,cD,cB,c_,c_,c_],
    [c_,c_,cB,cB,cB,cD,cD,cD,cD,cB,c_,c_],
    [c_,cB,cD,cD,cD,cD,cD,cD,cD,cD,cB,c_],
    [cB,cD,cD,cD,cD,cD,cD,cD,cB,cW,cB,c_],
    [c_,cB,cD,cD,cD,cD,cD,cD,cB,cB,cB,cB],
    [c_,c_,cB,cB,cB,cB,cB,cB,c_,c_,c_,c_],
    [c_,c_,c_,c_,c_,c_,c_,cB,c_,c_,c_,c_],
    [c_,c_,c_,c_,c_,c_,c_,c_,cB,cB,c_,c_],
];

// 5. Plant
const plantPixels = [
    [c_,c_,c_,c_,cB,c_,c_,c_,c_,c_,c_,c_],
    [c_,c_,c_,cB,cG,cB,c_,c_,c_,c_,c_,c_],
    [c_,c_,c_,cB,cG,cB,c_,cB,cB,c_,c_,c_],
    [c_,cB,cB,c_,cB,cG,cB,cG,cG,cB,c_,c_],
    [cB,cG,cG,cB,cB,cG,cG,cB,cB,c_,c_,c_],
    [c_,cB,cB,cG,cG,cG,cG,cG,cB,c_,c_,c_],
    [c_,c_,c_,cB,cG,cG,cG,cB,c_,c_,c_,c_],
    [c_,c_,c_,c_,cB,cG,cB,c_,c_,c_,c_,c_],
    [c_,c_,cB,cB,cB,cB,cB,cB,cB,c_,c_,c_],
    [c_,c_,cB,cC,cC,cC,cC,cC,cB,c_,c_,c_],
    [c_,c_,c_,cB,cC,cC,cC,cB,c_,c_,c_,c_],
    [c_,c_,c_,c_,cB,cB,cB,c_,c_,c_,c_,c_],
];

const write = (name, pixels) => {
    const h = pixels.length;
    const w = pixels[0].length;
    const svg = createSvg(pixels, w, h, 2);
    const dest = path.join('C:\\Users\\grask\\Documents\\cat_friend\\cat_animation\\PNG', name + '.svg');
    fs.writeFileSync(dest, svg);
    console.log('Wrote', dest);
}

write('gift_coffee', coffeePixels);
write('gift_fish', fishPixels);
write('gift_yarn', yarnPixels);
write('gift_mouse', mousePixels);
write('gift_plant', plantPixels);
