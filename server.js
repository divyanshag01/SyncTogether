const express = require("express");
const path = require("path");
const http = require("http");
const socketio = require("socket.io");
const app = express();
const rooms = {}; // all rooms to room id and room id to host,users,playback state
const userRoom = {}; // socket id to room id
const disconnectTimers = {}; 
// console.log(path.join(__dirname,"public"));
app.use(express.static(path.join(__dirname,"public")));
//routes
app.get("/watch/:roomId",(req,res)=>{
    res.sendFile(path.join(__dirname,"public","room.html"));
});
app.get("/ping",(req,res)=>{
    res.status(200).send("pong");
})
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);
const io = socketio(server);
//socket connection
io.on("connection", (socket)=>{
    //for new user connection
    socket.emit("message","Welcome to sync-n-play");
    //joining room
    socket.on("join-room",({guestId,username,roomId})=>{
        //for invalid id or room creation
        if(!rooms[roomId]){
            rooms[roomId]={
                host:guestId,
                users:[],
                mediaMetadata: null,
                playbackState:{
                    currentTime:0,
                    paused: true,
                    playbackRate:1,
                    lastUpdatedAt: Date.now()
                },
                playbackOffset:0
            };
        }
        //checking if already a member(if user refreshed the page)
        const existingUser = rooms[roomId].users.find(u=> u.guestId === guestId);
        if(existingUser){
            existingUser.disconnected = false;
            clearTimeout(disconnectTimers[guestId]);
            delete disconnectTimers[guestId];
            delete userRoom[existingUser.socketId];
            existingUser.socketId = socket.id;
            userRoom[socket.id] = roomId;
            socket.join(roomId);
            io.to(roomId).emit(
                "data-sent",
                rooms[roomId]
            );
            socket.to(roomId).emit("user-reconnected",existingUser.username);
            socket.emit("playback-state", rooms[roomId].playbackState);
            return;
        }else{
            //adding user to room{}
            rooms[roomId].users.push({
                guestId:guestId,
                socketId: socket.id,
                username:username,
                isHost:rooms[roomId].host === guestId,
                canControlPlayback: rooms[roomId].host === guestId,
                playbackOffset:0,
                disconnected: false,
            });
            userRoom[socket.id]= roomId;

            //actually joining room
            socket.join(roomId);
            socket.emit("joined-room",{username,roomId});
            socket.emit("playback-state",rooms[roomId].playbackState);
            socket.to(roomId).emit("user-joined",`${username} has joined the room`);
            io.to(roomId).emit("data-sent",rooms[roomId]);
        }


    });
    //User disconnects by clicking on leave button
    socket.on("user-leaves",({roomId})=>{
        if(!rooms[roomId]){
            return;
        }
        const index = rooms[roomId].users.findIndex(u=> u.socketId === socket.id);
        if(index===-1)return;
        const leavingUser = rooms[roomId].users[index];
        socket.to(roomId).emit("user-left",`${leavingUser.username} left the room`);
        rooms[roomId].users.splice(index,1);
        if(rooms[roomId].host===leavingUser.guestId){
            if(rooms[roomId].users.length>0){
            const newHost = rooms[roomId].users.find(u => !u.disconnected);
            if(newHost){
                newHost.isHost = true;
                rooms[roomId].host = newHost.guestId;
                newHost.canControlPlayback=true;
                newHost.playbackOffset = 0;
                io.to(roomId).emit("host-changed",newHost.username);
            };
        }
        }
        socket.leave(roomId);
        if(rooms[roomId] && rooms[roomId].users.length===0){
            delete rooms[roomId];
        }
        if(rooms[roomId] && rooms[roomId].users.length>0){
        io.to(roomId).emit("data-sent",rooms[roomId]);
        }
    });



    //disconnect message by leaving page or refreshing
    socket.on("disconnect",()=>{
        const roomId = userRoom[socket.id];
        if(!roomId || !rooms[roomId]){
            return;

        }
        const index = rooms[roomId].users.findIndex(u=> u.socketId === socket.id);
        if(index===-1)return;
        const leavingUser = rooms[roomId].users[index];
        leavingUser.disconnected = true;
        io.to(roomId).emit("data-sent",rooms[roomId]);
        disconnectTimers[leavingUser.guestId] = setTimeout(() => {
            if(!rooms[roomId]){
                delete disconnectTimers[leavingUser.guestId];
                return;
            }
            if(!leavingUser.disconnected){
                return;
            }
            const userIndex = rooms[roomId].users.findIndex(u=> u.guestId === leavingUser.guestId);
            if(userIndex===-1)return;
            rooms[roomId].users.splice(userIndex,1);
            if(rooms[roomId].host===leavingUser.guestId){
                if(rooms[roomId] && rooms[roomId].users.length>0){
                const newHost = rooms[roomId].users.find(u => !u.disconnected);
                if(newHost){
                    newHost.isHost = true;
                    rooms[roomId].host = newHost.guestId;
                    newHost.canControlPlayback=true;
                    newHost.playbackOffset = 0;
                    io.to(roomId).emit("host-changed",newHost.username);
                };
                }   
            }
            // socket.leave(roomId);
            if(rooms[roomId] && rooms[roomId].users.length>0){
            io.to(roomId).emit("data-sent",rooms[roomId]);
            } 
            else if(rooms[roomId] && rooms[roomId].users.length===0){
                delete rooms[roomId];
            }
            delete userRoom[socket.id];

        }, 30000);
        
    });
    //syncing video play
    socket.on("video-play",({roomId,currentTime})=>{
        const auth = validatePlaybackPermission(roomId,socket.id);
        if(!auth) return;
        rooms[roomId].playbackState = {
        currentTime,
        paused: false,
        playbackRate:rooms[roomId].playbackState.playbackRate,
        lastUpdatedAt: Date.now()
        };
        socket.to(roomId).emit("video-play",currentTime);
    });
    //syncing video pause
    socket.on("video-pause",({roomId,currentTime})=>{
        const auth = validatePlaybackPermission(roomId,socket.id);
        if(!auth) return;
        rooms[roomId].playbackState = {
        currentTime,
        paused: true,
        playbackRate:rooms[roomId].playbackState.playbackRate,
        lastUpdatedAt: Date.now()
        };
        socket.to(roomId).emit("video-pause",currentTime);
    });
    //syncing video seek
    socket.on("video-seek",({roomId,currentTime})=>{
        const auth = validatePlaybackPermission(roomId,socket.id);
        if(!auth) return;
        rooms[roomId].playbackState.currentTime = currentTime;
        rooms[roomId].playbackState.lastUpdatedAt = Date.now();
        socket.to(roomId).emit("video-seek",currentTime);
    });
    //heartbeat incoming, updating playback state
    socket.on("playback-heartbeat",({roomId,currentTime,paused,playbackRate})=>{
        const auth = validateHostAuthority(roomId,socket.id);
        if(!auth) return;
        const {room} = auth;
        room.playbackState = {
            currentTime,
            paused,
            playbackRate,
            lastUpdatedAt: Date.now()
        }
        socket.to(roomId).emit("playback-heartbeat",room.playbackState);

    });
    //adjusting playback rate
    socket.on("playback-ratechange",({roomId,playbackRate})=>{
        const auth = validatePlaybackPermission(roomId,socket.id);
        if(!auth) return;
        const { room } = auth;
        room.playbackState.playbackRate = playbackRate;
        socket.to(roomId).emit("playback-ratechange",playbackRate);
    });
    //validate permission for controlling playback
    function validatePlaybackPermission(roomId,socketId){
        const room = rooms[roomId];
        if(!room){
            return;

        }
        const user = room.users.find(u =>u.socketId===socketId);
        if(!user) return;
        if(!user.canControlPlayback) return;
        return {
            room,
            user
        };
    };
    function validateHostAuthority(roomId,socketId){
        const room = rooms[roomId];
        if(!room){
            return;

        }
        const user = room.users.find(u =>u.socketId===socketId);
        if(!user) return;
        if(!user.isHost) return;
        return {
            room,
            user
        };
    };
    //Validating metadata match with hosts
    socket.on("video-metadata",({roomId,metadata})=>{
        const room = rooms[roomId];
        if(!room){
            return;

        }
        const user = room.users.find(u =>u.socketId===socket.id);
        if(!user) return;
        if(!room.mediaMetadata){
            if(!user.isHost){
                socket.emit("waiting-for-host");
                return;
            }
            room.mediaMetadata = metadata;
            io.to(roomId).emit("media-ready",metadata);
        }else{
            if(user.isHost){
            room.mediaMetadata = metadata;
            io.to(roomId).emit("media-ready",metadata);
            }else{
                socket.emit("media-ready",room.mediaMetadata);
            };
        }
    });
    socket.on("update-playback-permission",({roomId,targetGuestId,canControlPlayback})=>{
        const auth = validateHostAuthority(roomId,socket.id);
        if(!auth){
            return;
        }
        const user = rooms[roomId].users.find(u=> u.guestId === targetGuestId);
        if(!user){
            return;
        }
        if(user.isHost) return;
        user.canControlPlayback = canControlPlayback;
        io.to(roomId).emit("data-sent",rooms[roomId]);
    });
    //chat feature
    socket.on("send-message",({roomId,username,message})=>{
        if(!rooms[roomId]){
            return;
        }
        const checkUser = rooms[roomId].users.find(u=> u.socketId === socket.id);
        if(!checkUser){
            return;
        }
        io.to(roomId).emit("message-received",{
            username: checkUser.username,
            message,
            timeStamp: Date.now()
        });
    });
    socket.on("update-offset",({roomId,offset})=>{
        if(!rooms[roomId]){
            return;
        }
        const user = rooms[roomId].users.find(u=>u.socketId===socket.id);
        if(!user || user.isHost){
            return;
        }
        user.playbackOffset = offset;
        io.to(roomId).emit("data-sent",rooms[roomId]);
    })
});

server.listen(PORT,()=> console.log(`Server is listening on http://localhost:${PORT}`));