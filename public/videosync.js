import { extractEmbeddedSubtitles } from "./subtitles/subtitles-manager.js";
import { showToast } from "./utils.js";
window.uiState = {
    syncStatus: "Waiting",
    offset: 0,
    subtitleCount: 0,
    compatibility: "Unknown",
    participantCount: 1,
    hostName: "",
    controllerName: ""
};
export function initializeVideoSync(
    socket,
    roomId
){
// selecting html elements
const videoInput = document.getElementById("video-input");
const video = document.getElementById("video-player");
const subtitleInput = document.getElementById("subtitle-input");
const subtitleTrackSelect = document.getElementById("subtitle-track-select");
//custom video controllers
const playBtn = document.getElementById("player-play-btn");
const rewindBtn = document.getElementById("player-rewind-btn");
const forwardBtn = document.getElementById("player-forward-btn");
const seekBar = document.getElementById("player-seek-bar");
const timeDisplay = document.getElementById("player-time-display");
const volumeBtn = document.getElementById("player-volume-btn");
const volumeSlider = document.getElementById("player-volume-slider");
const fullscreenBtn = document.getElementById("player-fullscreen-btn");
const videoStage = document.querySelector(".video-stage");
const speedBtn = document.getElementById("player-speed-btn");
const speedMenu = document.getElementById("player-speed-menu");
const speedOptions = document.querySelectorAll(".speed-option");
let isDraggingSeekBar = false;
video.volume = 0.8;
volumeSlider.value = 80;
let previousVolume = 0.8;
seekBar.disabled = true;

function updateFullScreenIcon(){
    if(document.fullscreenElement){
        fullscreenBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"/>
                <polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>`;
    }else{
        fullscreenBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 14 10 14 10 20"/>
                <polyline points="20 10 14 10 14 4"/>
                <line x1="14" y1="10" x2="21" y2="3"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>`;
    }
}
document.addEventListener("fullscreenchange",()=>{
    updateFullScreenIcon();
})

fullscreenBtn.addEventListener("click",async ()=>{
    if(!isVideoReady){
        showToast("Select video first");
        return;
    }
    if(!document.fullscreenElement){
        await videoStage.requestFullscreen();
    }else{
        await document.exitFullscreen();
    }
})

playBtn.addEventListener("click",()=>{
    if(!isVideoReady){
        showToast("Load a video first");
        return;
    }
    if(video.paused){
        video.play();
    }else{
        video.pause();
    }
})
//updating icon
video.addEventListener("play", () => {
    playBtn.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
        </svg>
    `;
});
//other controls
rewindBtn.addEventListener("click",()=>{
    if(!isVideoReady){
        showToast("Load a video first");
        return;
    }
    video.currentTime = Math.max(0,video.currentTime - 10);
});
forwardBtn.addEventListener("click",()=>{
    if(!isVideoReady){
        showToast("Load a video first");
        return;
    }
    video.currentTime = Math.min(video.duration,video.currentTime + 10);
});

video.addEventListener("pause", () => {
    playBtn.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21"/>
        </svg>
    `;
});
//function to display time
function formatTime(seconds){
    if(Number.isNaN(seconds)){
        return "0:00";
    }
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if(hrs > 0){
        return `${hrs}:${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
    }

    return `${mins}:${String(secs).padStart(2,"0")}`;
}
function updateTimeDisplay(){
    if(!isVideoReady){
        timeDisplay.textContent = "0:00 / 0:00";
        return;
    }

    timeDisplay.textContent =
        `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
}
video.addEventListener("timeupdate",()=>{
    updateTimeDisplay();
});
video.addEventListener("timeupdate",()=>{
    if(!isVideoReady){
        return;
    }
    if(isDraggingSeekBar) return;
    seekBar.value = (video.currentTime/video.duration)*100;
});
seekBar.addEventListener("input",()=>{
    if(seekBar.disabled){
        return;
    }
    isDraggingSeekBar = true;
    const previewTime = (seekBar.value / 100) * video.duration;

    timeDisplay.textContent = `${formatTime(previewTime)} / ${formatTime(video.duration)}`;
});
seekBar.addEventListener("change",()=>{
    if(!isVideoReady){
        return;
    }
    video.currentTime = (seekBar.value/100)*video.duration;
    isDraggingSeekBar = false;
})
document.addEventListener("mouseup",()=>{
    isDraggingSeekBar = false;
});
function updateSeekBarPermissions(){
    const canControl =
        window.isHost || window.uiState.canControlPlayback;

    seekBar.disabled = !isVideoReady || !canControl;
}
volumeSlider.addEventListener("input", () => {

    video.volume = volumeSlider.value / 100;
});
volumeBtn.addEventListener("click", () => {
    if(video.volume > 0){
        previousVolume = video.volume;
        video.volume = 0;
        volumeSlider.value = 0;
    }else{
        video.volume = previousVolume || 1;
        volumeSlider.value = video.volume * 100;
    }

});
video.addEventListener("volumechange", () => {
    volumeSlider.value = video.volume * 100;
});
video.addEventListener("volumechange", () => {

    if(video.volume === 0){
        volumeBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>`;
    }
    else if(video.volume < 0.5){
        volumeBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>`;
    }
    else{
        volumeBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>`;
    }

});

//subtitle
let currentSubtitleTrack = null;
let embeddedSubtitleTracks = [];
// for updating playback state for new users
let pendingPlaybackState = null;
//to check if video is loaded(metadata)
let isVideoReady = false;
//for monitoring sync every 2 sec
let heartbeatInterval = null;
//to ensure the drift algo dont change playback every second and wait for 3 sec
let lastCorrectionTime = 0;
const correctionCooldown = 3000;
//drift algo
let authoritativePlaybackRate = 1;
let correctionFactor = 1;
// video verification
let localMetadata = null;
//syncrhonization gating
let isMediaCompatible = false;
//offset
let playbackOffset = 0;
function updateSpeedUI(){

    speedBtn.textContent = `${authoritativePlaybackRate}x`;
    speedOptions.forEach(option=>{
        option.classList.toggle("speed-option-active",Number(option.dataset.speed) === authoritativePlaybackRate);
    });

}
speedOptions.forEach(option=>{
    option.addEventListener("click",()=>{
        const speed = Number(option.dataset.speed);
        authoritativePlaybackRate = speed;
        correctionFactor = 1;
        updatePlaybackRate();
    });
});
function convertHostTimeToLocalTime(hostTime){
    const translatedTime = hostTime + playbackOffset;
    if(translatedTime<0){
        return{
            valid:false,
            reason:"before-start"
        };
    }
    if(translatedTime>video.duration){
        return{
            valid:false,
            reason:"after-end"
        };
    }
    return{
            valid:true,
            time:translatedTime
        };;
};
function convertLocalTimeToHostTime(localTime){
    return localTime - playbackOffset;
}
socket.on("data-sent",(room)=>{
    const currentUser = room.users.find(u => u.socketId === socket.id);
    updateSeekBarPermissions();
    if(currentUser?.isHost){
        playbackOffset = 0;
        window.uiState.offset = 0;
    }else{
        playbackOffset = currentUser?.playbackOffset || 0;
        window.uiState.offset = playbackOffset;

    }
});
//file selected
videoInput.addEventListener("change",(event)=>{
   const file = event.target.files[0];
   if(!file) return;
   const videoURL = URL.createObjectURL(file);
   isVideoReady = false;
   video.src = videoURL;

});
//metadata loaded video ready to play
video.addEventListener("loadedmetadata",()=>{
    isVideoReady = true;
    updateSeekBarPermissions();
    seekBar.value = 0;
    updateTimeDisplay();
    const metadata = {
        duration: video.duration,
        filename: videoInput.files[0].name,
        size: videoInput.files[0].size
    };
    localMetadata = metadata;
    extractSubtitles(videoInput.files[0]);
    socket.emit("video-metadata",{
        roomId,
        metadata
    });
    //syncing new user
    if(pendingPlaybackState){
    applyPendingPlaybackState(pendingPlaybackState);
   }
   pendingPlaybackState = null;
});
video.addEventListener("click",(e)=>{
    if(!isVideoReady){
        return;
    }
    if(e.pointerType === "touch"){
        return;
    }
    if(video.paused){
        video.play();
    }else{
        video.pause();
    }
});
//variables to prevent play pause loop
let ignorePlayEvent = false;
let ignorePauseEvent = false;
let ignoreSeekEvent = false;
let ignoreRateChange = false;
//applying playback state for new user
function applyPendingPlaybackState(playbackState){
    if(!isMediaCompatible){
        return;
    }
    const translatedTime = convertHostTimeToLocalTime(playbackState.currentTime);
    if(translatedTime.valid ===false && translatedTime.reason==="before-start"){
        video.pause();
        showToast("waiting for host to reach valid offset")
        video.currentTime = 0;
        return;
    }else if(translatedTime.valid ===false && translatedTime.reason==="after-end"){
        video.pause();
        showToast("video ended");
        video.currentTime = video.duration;
        return;
    }
    authoritativePlaybackRate = playbackState.playbackRate || 1;
    correctionFactor = 1;
    updatePlaybackRate();
    video.currentTime = translatedTime.time;
    if(playbackState.paused) video.pause();
    else video.play();
}
//adjusting playback rate;
function updatePlaybackRate(){
    video.playbackRate = authoritativePlaybackRate * correctionFactor;
    updateSpeedUI();
}
// detecting local play
video.addEventListener("play",()=>{
    if(ignorePlayEvent===true){
        ignorePlayEvent = false;
        return;
    };
    //sending play event to server
    socket.emit("video-play",{
        roomId:roomId,
        currentTime: convertLocalTimeToHostTime(video.currentTime)
    })
    startHeartBeat();
});
video.addEventListener("ratechange",()=>{

    if(ignoreRateChange===true){
        ignoreRateChange = false;
        return;
    };
    authoritativePlaybackRate = video.playbackRate/correctionFactor;
    //sending ratechange event to server
    socket.emit("playback-ratechange",{
        roomId:roomId,
        playbackRate: authoritativePlaybackRate
    })
});
//detecting local pause
video.addEventListener("pause",()=>{
    if(ignorePauseEvent===true){
        ignorePauseEvent = false;
        return;
    }
    // sending pause to server
    socket.emit("video-pause",{
        roomId:roomId,
        currentTime: convertLocalTimeToHostTime(video.currentTime)
    })
});
// detecting local seek
video.addEventListener("seeked",()=>{
    updateTimeDisplay();
    if(ignoreSeekEvent===true){
        ignoreSeekEvent = false;
        return;
    }
    //sending seek event to server
    socket.emit("video-seek",{
        roomId: roomId,
        currentTime:convertLocalTimeToHostTime(video.currentTime)
    });
});
//syncing seek
socket.on("video-seek",(currentTime)=>{
    if(!isVideoReady){
        return;
    }
    if(!isMediaCompatible){
        return;
    };
    const translatedTime = convertHostTimeToLocalTime(currentTime);
    if(translatedTime.valid ===false && translatedTime.reason==="before-start"){
        video.pause();
        showToast("waiting for host to reach valid offset");
        video.currentTime = 0;
        return;
    }else if(translatedTime.valid ===false && translatedTime.reason==="after-end"){
        video.pause();
        showToast("video ended");
        video.currentTime = video.duration;
        return;
    }
    ignoreSeekEvent=true
    video.currentTime = translatedTime.time;
});
//syncing play
socket.on("video-play",(currentTime)=>{
    if(!isVideoReady){
       return;
    }
    if(!isMediaCompatible){
        showToast("sync disabled due to incompatible media");
        return;
    };
    const translatedTime = convertHostTimeToLocalTime(currentTime);
    if(translatedTime.valid ===false && translatedTime.reason==="before-start"){
        video.pause();
        showToast("waiting for host to reach valid offset");
        video.currentTime = 0;
        return;
    }else if(translatedTime.valid ===false && translatedTime.reason==="after-end"){
        video.pause();
        showToast("video ended");
        video.currentTime = video.duration;
        return;
    }
     ignorePlayEvent = true;
     ignoreSeekEvent = true;
     video.currentTime = translatedTime.time;
     correctionFactor = 1;
     updatePlaybackRate();
     video.play();
     startHeartBeat();
});
//syncing pause
socket.on("video-pause",(currentTime)=>{
    if(!isVideoReady){
       return;
    }   
    if(!isMediaCompatible){
        showToast("sync disabled due to incompatible media");
        return;
    };
    const translatedTime = convertHostTimeToLocalTime(currentTime);
    if(translatedTime.valid ===false && translatedTime.reason==="before-start"){
        video.pause();
        showToast("waiting for host to reach valid offset");
        video.currentTime = 0;
        return;
    }else if(translatedTime.valid ===false && translatedTime.reason==="after-end"){
        video.pause();
        showToast("video ended");
        video.currentTime = video.duration;
        return;
    }
     ignorePauseEvent = true;
     ignoreSeekEvent = true;
     video.currentTime = translatedTime.time;
     video.pause();
})
//syncing playback rate
socket.on("playback-ratechange",(playbackRate)=>{
    if(!isVideoReady){
        return;
    }   
    if(!isMediaCompatible){
        showToast("sync disabled due to incompatible media");
        return;
    };
    ignoreRateChange = true;
    authoritativePlaybackRate = playbackRate;
    updatePlaybackRate();

});
//on user joining, syncing state(only for new user)
socket.on("playback-state",(playbackState)=>{
    if(!isVideoReady){
        pendingPlaybackState = playbackState;
        return;
    }
    if(!isMediaCompatible){
        showToast("sync disabled due to incompatible media");
        return;
    };
    applyPendingPlaybackState(playbackState);
});
//heartbeat
function startHeartBeat(){
    if(heartbeatInterval){
        return;
    }
    heartbeatInterval = setInterval(()=>{
        socket.emit("playback-heartbeat",{
            roomId: roomId,
            currentTime:convertLocalTimeToHostTime(video.currentTime),
            paused:video.paused,
            playbackRate: authoritativePlaybackRate
        }
        );

    },2000);
}
function stopHeartbeat(){
    //nothing running
    if(!heartbeatInterval){
        return;
    }
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;

}

//observing drift between users
socket.on("playback-heartbeat",(state)=>{
    if(!isMediaCompatible){
        return;
    };
    if(!isVideoReady) return;
    authoritativePlaybackRate = state.playbackRate;
    if(state.paused !== video.paused){
        if(state.paused){
            ignorePauseEvent = true;
            correctionFactor = 1;
            updatePlaybackRate();
            video.pause();
        }else{
            ignorePlayEvent = true;
            correctionFactor = 1;
            updatePlaybackRate();
            video.play();
        }
    }
    const translatedTime = convertHostTimeToLocalTime(state.currentTime);
    if(translatedTime.valid ===false && translatedTime.reason==="before-start"){
        video.pause();
        showToast("waiting for host to reach valid offset");
        video.currentTime = 0;
        return;
    }else if(translatedTime.valid ===false && translatedTime.reason==="after-end"){
        video.pause();
        showToast("video ended");
        video.currentTime = video.duration;
        return;
    }
    const drift = translatedTime.time-video.currentTime;
    const absDrift = Math.abs(drift);
    if(absDrift<0.35){
        window.uiState.syncStatus ="Synced";
        correctionFactor = 1;
        updatePlaybackRate();
        return;
    }else{
        window.uiState.syncStatus = "Syncing";
    }
    const now = Date.now();
    if(now-lastCorrectionTime < correctionCooldown){
        return;
    }
    else if(absDrift>=2){
        ignoreSeekEvent = true;
        correctionFactor = 1;
        updatePlaybackRate();
        lastCorrectionTime = now;
        // ignoreSeekEvent = true;
        video.currentTime= translatedTime.time;
        return;
    }else if(absDrift>=0.35 && absDrift<2){
        if(drift<0){
            // console.log("playback adjusted to 0.98");
            lastCorrectionTime = now;
            correctionFactor = 0.97;
            updatePlaybackRate();
        }else if(drift>0){
            // console.log("playback adjusted to 1.02");
            lastCorrectionTime = now;
            correctionFactor = 1.03;  
            updatePlaybackRate();
        }
        return;
    }

});
socket.on("media-ready",(metadata)=>{
    if(!localMetadata){
        isMediaCompatible = false;
        return;
    }
    const validation = evaluateMediaCompatibility(metadata,localMetadata);
    window.uiState.compatibility = validation.confidence;
    isMediaCompatible = validation.syncAllowed;

})
socket.on("waiting-for-host",()=>{
    showToast("waiting for host");
})
function evaluateMediaCompatibility(metadata, localMetadata){
    if(!metadata || !localMetadata){
        return{
        syncAllowed: false,
        confidence: "low",
        warning: "missing metadata" 
    }
    }
    const normalizedLocalFilename = localMetadata.filename.trim().toLowerCase();
    const normalizedHostFilename =metadata.filename.trim().toLowerCase();
    const sameFilename = normalizedHostFilename === normalizedLocalFilename;
    const durationDiff = Math.abs(metadata.duration - localMetadata.duration);
    const percentageDiff = (durationDiff/metadata.duration)*100;
    if(percentageDiff<2 && sameFilename){
        return{
            syncAllowed: true,
            confidence: "high",
            warning: ""
        };
    }
    if(percentageDiff<8 && sameFilename){
        return{
            syncAllowed: true,
            confidence: "high",
            warning: "video duration slightly different"
        };
    }
    if(percentageDiff<3 && !sameFilename){
        return{
            syncAllowed: true,
            confidence: "medium",
            warning: "Filename is different"
        };
    }
    if(percentageDiff<8 && !sameFilename){
        return{
            syncAllowed: true,
            confidence: "medium",
            warning: "Filename and duration is different"
        };
    }
    if(sameFilename && percentageDiff<18){
        return{
            syncAllowed: true,
            confidence: "low",
            warning: "Large mismatch needs offset"           
        }
    }
    if(!sameFilename && percentageDiff<18){
        return{
            syncAllowed: true,
            confidence: "low",
            warning: "Large mismatch needs offset"           
        }
    }
    return{
        syncAllowed: false,
        confidence: "low",
        warning: "Media incompatible" 
    }
}
function convertSRTtoVTT(srtText){
    return("WEBVTT\n\n" + srtText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
};
subtitleInput.addEventListener("change",async (event)=>{
    const file = event.target.files[0];
    if(!file) return;
    if(currentSubtitleTrack){
        currentSubtitleTrack.remove();
    }
    let subtitleText = await file.text();
    if(file.name.toLowerCase().endsWith(".srt")){
        subtitleText = convertSRTtoVTT(subtitleText);
    }
    const blob = new Blob([subtitleText],{type:"text/vtt"});
    const subtitleURL = URL.createObjectURL(blob);
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = "English";
    track.srclang = "en";
    track.src = subtitleURL;
    track.default = true;
    track.track.mode = "showing";
    video.append(track);
    currentSubtitleTrack = track;
    showToast("subtitle loaded");

});
//extracting subtitles and applying them
async function extractSubtitles(file) {
    try{
        embeddedSubtitleTracks = await extractEmbeddedSubtitles(file);
        window.uiState.subtitleCount = embeddedSubtitleTracks.length;

        subtitleTrackSelect.innerHTML = `<option value="">Select Subtitle</option>`;
        if(embeddedSubtitleTracks.length===0){
            showToast("no subtitles found");
            return;
        }
        embeddedSubtitleTracks.forEach((track,index)=>{
            const option = document.createElement("option");
            option.value = index;
            option.textContent = `${track.label} (${track.language})`;
            subtitleTrackSelect.appendChild(option);
        });
        showToast("subtitle dropdown populated");
    }catch(err){
        showToast("subtitle extraction failed");
    }
};
subtitleTrackSelect.addEventListener("change",()=>{
    const selectedIndex = subtitleTrackSelect.value;
    if(selectedIndex==""){
        return;
    }
    loadSubtitleTrack(selectedIndex);
});
function loadSubtitleTrack(index){
    const selectedTrack = embeddedSubtitleTracks[index];
    if(!selectedTrack){
        return;
    }
    if(currentSubtitleTrack){
        currentSubtitleTrack.remove();
    }
    const blob = new Blob([selectedTrack.vtt],{type: "text/vtt"});
    const subtitleURL = URL.createObjectURL(blob);
    const track = document.createElement("track");

    track.kind = "subtitles";
    track.label = selectedTrack.label;

    track.srclang = selectedTrack.language;
    track.src = subtitleURL;
    track.default = true;
    video.appendChild(track);
    currentSubtitleTrack = track;
    track.track.mode = "showing";

    showToast(`Subtitle track loaded: ${selectedTrack.label}`);
};
document.addEventListener("keydown",(e)=>{
    const activeElement = document.activeElement;
    const isTyping = activeElement && (activeElement.tagName=== "INPUT" || activeElement.tagName=== "TEXTAREA" || activeElement.tagName=== "SELECT");
    if(isTyping) return;
    if(!isVideoReady){
        return;
    }
    if(e.code==="Space"){
        e.preventDefault();
        if(video.paused){
            video.play();
        }else{
            video.pause();
        }
    }
    if(e.code==="ArrowLeft"){
        e.preventDefault();
        rewindBtn.click();
    }
    if(e.code==="ArrowRight"){
        e.preventDefault();
        forwardBtn.click();
    }
    if(e.code==="ArrowUp"){
        e.preventDefault();
        video.volume = Math.min(1,video.volume + 0.05);
    }
    if(e.code==="ArrowDown"){
        e.preventDefault();
        video.volume = Math.max(0,video.volume - 0.05);
    }
    if(e.code==="KeyM"){
        e.preventDefault();
        volumeBtn.click();
    }
    if(e.code==="KeyF"){
        e.preventDefault();
        fullscreenBtn.click();
    }

})

};
