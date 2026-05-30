export function showToast(message){

    const toast = document.createElement("div");
    toast.classList.add("toast");
    toast.innerText = message;
    document.getElementById("toast-container").appendChild(toast);

    setTimeout(()=>{
        toast.remove();
    },3000);
};
export function generateRandomUsername(){
    const adjectives = [
        "Silver",
        "Blue",
        "Swift",
        "Shadow",
        "Golden",
        "Nova",
        "Iron",
        "Crimson"
    ];

    const animals = [
        "Fox",
        "Wolf",
        "Falcon",
        "Tiger",
        "Bear",
        "Raven",
        "Hawk",
        "Panther"
    ];
    const adjective = adjectives[Math.floor(Math.random()*adjectives.length)];
    const animal = animals[Math.floor(Math.random()*animals.length)];
    return `${adjective}${animal}`;

}