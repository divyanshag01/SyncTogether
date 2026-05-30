export async function extractEmbeddedSubtitles(file) {
     const parts = file.name.split(".");

    if(parts.length < 2){
        return [];
    }
    const ext = parts.pop().toLowerCase();
    if(ext==="mkv"){
        const parser = await import("./mkv-subtitle-parser.js");
        return parser.extractSubtitles(file);
    }    
    if(ext==="mp4" || ext ==="m4v" || ext ==="mov"){
        const parser = await import("./mp4-subtitle-parser.js");
        return parser.extractSubtitles(file);
    }
    return [];  
}