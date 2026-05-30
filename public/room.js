import { initializeVideoSync } from "./videosync.js";
import { showToast } from "./utils.js";
import { generateRandomUsername } from "./utils.js";
const socket = io();
// const params = new URLSearchParams(window.location.search);
let username = localStorage.getItem("username");
const roomId = window.location.pathname.split("/").pop();
const roomDetail = document.getElementById("room-id");
let guestId = localStorage.getItem("guestId");
if(!guestId){
    guestId = crypto.randomUUID();
    localStorage.setItem("guestId",guestId);
};
const shareLinkBtn = document.getElementById("share-room-link");
//chat elements
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const sendChatBtn = document.getElementById("send-chat");
//offset elements
const offsetDirection = document.getElementById("offset-direction");
const offsetSeconds = document.getElementById("offset-seconds");
const applyOffsetBtn = document.getElementById("apply-offset");
const clearOffsetBtn = document.getElementById("clear-offset");
//random username


if(!username || !username.trim()){
    username = generateRandomUsername();
    localStorage.setItem("username",username);
}
localStorage.setItem("username",username.trim());
//welcome message
socket.on("message", message=>{
    // showToast(message);
});
//copy/share link
shareLinkBtn.addEventListener("click",async ()=>{
    try{
        await navigator.clipboard.writeText(window.location.href);
        showToast("Link Copied");
    }catch(err){
        showToast("Error copying link, try again");
    }
})
// displaying room id
roomDetail.innerText=`Room ID: ${roomId}`;
//user disconnected
socket.on("user-disconnected", message=>{
    showToast(message);
});
//room id is invalid
socket.on("invalid-room",(message)=>{
   showToast(message);
});

//user joined emiting to every other user
socket.on("user-joined",(message)=>{
    showToast(message);
});
//Displaying participant list
const usersList = document.getElementById("users-list");
// socket.emit("get-data",roomId);
const hostNameHtml = document.getElementById("host-name");
window.isHost = false;
socket.on("data-sent",(room)=>{
    window.uiState.participantCount = room.users.length;
    const host = room.users.find(u=>u.isHost);
    window.uiState.hostName = host?.username || "";
    hostNameHtml.innerText = window.uiState.hostName;
    const controller = room.users.find(u=>u.canControlPlayback && !u.isHost);
    window.uiState.controllerName = controller?.username || "";
    usersList.innerHTML = "";
    const currentUser = room.users.find(u=> u.socketId === socket.id);
    room.users.forEach(user => {
        const li = document.createElement("li");
        li.dataset.role = user.isHost ? 'host' : user.canControlPlayback ? 'controller' : 'viewer';
        li.dataset.username = user.username;
        const usernameSpan = document.createElement("span");
        window.isHost = currentUser?.isHost || false;
        window.uiState.canControlPlayback = currentUser?.canControlPlayback || false;
        if(user.isHost === true){
            usernameSpan.innerText = `${user.username}`;
        }else if(user.canControlPlayback){
            usernameSpan.innerText = `${user.username}`
        }else{
            usernameSpan.innerText = user.username;
        }
        li.appendChild(usernameSpan);
        if(currentUser && currentUser.isHost && !user.isHost){
            const btn = document.createElement("button");
            if(user.canControlPlayback){
                btn.innerText = "Remove";
            }else{
                btn.innerText= "Grant";
            }
            li.appendChild(btn);
            btn.addEventListener("click",()=>{
                if(user.canControlPlayback){
                    showToast(`${user.username} playback control removed`);
                }else{
                    showToast(`${user.username} granted playback control`);
                }
                socket.emit("update-playback-permission",{
                    roomId: roomId,
                    targetGuestId: user.guestId,
                    canControlPlayback:!user.canControlPlayback
                });
                
            })
        };
        usersList.appendChild(li);
});

});
//diconnect handling
//leave button
const leaveBtn = document.getElementById("leave-btn");
leaveBtn.addEventListener("click",()=>{
    socket.emit("user-leaves",{roomId});
    window.location.href="/";
})
socket.on("host-changed",(username)=>{
    showToast(`${username} is now the host`);
});
socket.on("user-reconnected",(username)=>{
    showToast(`${username} reconnected`);
});
socket.on("user-left",(message)=>{
    showToast(message);
});


socket.emit("join-room",{
    guestId,
    username,
    roomId
});
// chat 
sendChatBtn.addEventListener("click",()=>{
    const message = chatInput.value.trim();
    if(!message){
        return;
    }
    socket.emit("send-message",{
        roomId,
        username,
        message
    });
    chatInput.value = "";
});
socket.on("message-received",({username,message,timeStamp})=>{
    const messageDiv = document.createElement("div");
    const time = new Date(timeStamp).toLocaleTimeString([],{
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
    messageDiv.innerText = `${username} ${time}: ${message}`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
})
chatInput.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){
        sendChatBtn.click();
    }
});
applyOffsetBtn.addEventListener("click",()=>{
    const direction =  offsetDirection.value;
    if(!direction){
        showToast("Select a direction to apply offset");
        return;
    }
    const seconds = Number(offsetSeconds.value);
    if(window.isHost){
        showToast("Host cannot set offset");
        return;
    }
    if(!seconds || seconds<0){
        return;
    };
    let offset;
    if(direction === "ahead"){
        offset = -seconds;
    }else{
        offset = seconds;
    }
    socket.emit("update-offset",{roomId,offset});
});
clearOffsetBtn.addEventListener("click",()=>{

    if(window.isHost){
        showToast("Host cannot set offset");
        return;
    }
    socket.emit("update-offset",{roomId,offset:0});
    showToast("Offset cleared");
});


initializeVideoSync(
    socket,
    roomId
);