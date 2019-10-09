const defaultForwardAddress = process.env.vmq_zeromq_forward_address || "tcp://127.0.0.1:5000";
const defaultSubAddress = process.env.vmq_zeromq_sub_address || "tcp://127.0.0.1:5000";
const defaultPubAddress = process.env.vmq_zeromq_pub_address || "tcp://127.0.0.1:5001";

let zmq = require("../../../node_modules/zeromq");

function registerKiller(children, method){
    const events = ["SIGINT", "SIGUSR1", "SIGUSR2", "uncaughtException", "SIGTERM", "SIGHUP"];

    events.forEach(function(event){
        process.on(event, function(){
            children.forEach(function(child){
                if(method){
                    child[method](0);
                }else{
                    child.close();
                }
            });
        });
    });
}

function ZeromqForwarder(bindAddress){

    let socket = zmq.socket("pub");
    let initialized = false;

    function connect(){
        socket.monitor();
        socket.connect(bindAddress);

        socket.on("connect",(fd)=>{
            console.log(`\nZeromq forwarder connected on ${bindAddress}\n`);
            initialized = true;
            sendBuffered();
        });
    }

    connect();

    registerKiller([socket]);

    const Queue = require("swarmutils").Queue;
    let buffered = new Queue();

    let sendBuffered = ()=>{
        while(buffered.length>0){
            this.send(...buffered.pop());
        }
    };

    this.send = function(channel, ...args){
        if(initialized){
            console.log("[Forwarder] Putting message on socket", args);
            socket.send([channel, ...args], undefined, (...args)=>{
                console.log("What a got", ...args);
            });
        }else{
            console.log("[Forwarder] Saving it for later");
            buffered.push([channel, ...args]);
        }
    }
}

function ZeromqProxyNode(subAddress, pubAddress, signatureChecker){

    const publishersNode = zmq.createSocket('xsub');
    const subscribersNode = zmq.createSocket('xpub');

    // By default xpub only signals new subscriptions
    // Settings it to verbose = 1 , will signal on every new subscribe
    // uncomment next lines if messages are lost
    subscribersNode.setsockopt(zmq.ZMQ_XPUB_VERBOSE, 1);

    publishersNode.on('message', (...args) => {
        console.log(`[Proxy] - Received`, args);
        subscribersNode.send(args);
    });

    subscribersNode.on('message', function(subscription){
        console.log("[Proxy] - manage message", subscription.toString());

        let message = subscription.toString();
        let type = subscription[0];
        message = message.substr(1);

        console.log(`[Proxy] - Trying to send ${type==1?"subscribe":"unsubscribe"} type of message`);

        if(typeof signatureChecker === "undefined"){
            console.log("[Proxy] - No signature checker defined then transparent proxy...");
            return publishersNode.send(subscription);
        }

        try{
            console.log("[Proxy] - let's deserialize and start analize");
            let deserializedData = JSON.parse(message);
            //TODO: check deserializedData.signature
            console.log("[Proxy] - Start checking message signature");
            signatureChecker(deserializedData.channelName, deserializedData.signature, (err, res)=>{
                if(err){
                    //...
                    console.log("Err", err);
                }else{
                    //let newSub = Buffer.concat([Buffer.from(type.toString()), Buffer.from(deserializedData.channelName)]);
                    //let newSub = Buffer.from(type+deserializedData.channelName.toString());
                    let newSub = Buffer.alloc(deserializedData.channelName.length+1);
                    newSub.write("01", 0, 1, "hex");
                    Buffer.from(deserializedData.channelName).copy(newSub, 1);
                    console.log("[Proxy] - sending subscription", "\n\t\t", subscription.toString('hex'), "\n\t\t", newSub.toString('hex'), newSub.toString());
                    publishersNode.send(newSub);
                }
            });
        }catch(err){
            console.log("Something went wrong. Subscription will not be made.", err);
        }

    });

    try{
        publishersNode.bindSync(pubAddress);
        subscribersNode.bindSync(subAddress);
        console.log(`\nStarting ZeroMQ proxy on [subs:${subAddress}] [pubs:${pubAddress}]\n`);
    }catch(err){
        console.log("Caught error on binding", err);
        throw new Error("No zeromq!!!");
    }

    registerKiller([publishersNode, subscribersNode]);
}

let instance;
module.exports.getForwarderInstance = function(address){
    if(!instance){
        address = address || defaultForwardAddress;
        instance = new ZeromqForwarder(address);
    }
    return instance;
};

module.exports.createZeromqProxyNode = function(subAddress, pubAddress, signatureChecker){
    subAddress = subAddress || defaultSubAddress;
    pubAddress = pubAddress || defaultPubAddress;
    return new ZeromqProxyNode(subAddress, pubAddress, signatureChecker);
};

module.exports.registerKiller = registerKiller;