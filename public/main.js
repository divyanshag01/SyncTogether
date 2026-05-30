import { generateRandomUsername } from "./utils.js";
let guestId = localStorage.getItem("guestId");
if(!guestId){
    guestId = crypto.randomUUID();
    localStorage.setItem("guestId",guestId);
};



let username = localStorage.getItem("username");
// console.log(guestId);
if(!username){
    username = generateRandomUsername();
    localStorage.setItem("username",username);
}
const createBtn = document.getElementById("create-room");
const usernameInput = document.getElementById("user-name");
usernameInput.value = username;
usernameInput.select();
//create room
createBtn.addEventListener("click",()=>{
    const usernameInputValue = usernameInput.value.trim();
    if(usernameInputValue){
        localStorage.setItem("username",usernameInputValue);
    }
    const roomId = Math.random().toString(36).substring(2,8);
    window.location.assign(`/watch/${roomId}`);
    
});
//room id and join btn document
const joinBtn = document.getElementById("join-room");
const idInput = document.getElementById("room-id");
//join btn click event
joinBtn.addEventListener("click",()=>{
    const roomId = idInput.value;
    if(!roomId.trim()){
        return;
    }
    const usernameInputValue = usernameInput.value.trim();
    if(usernameInputValue){
        localStorage.setItem("username",usernameInputValue);
    }

    window.location.assign(`/watch/${roomId}`);
});
