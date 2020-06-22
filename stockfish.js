const Engine = require("node-uci").Engine;
const express = require("express");
const {Chess} = require('chess.js');
const PolyglotBook = require("./polygotbook");
const app = express();

let book;

const os = require('os')
const cpuCount = os.cpus().length

console.log("Found " + cpuCount + " CPUs");

const game = new Chess();
const engine = new Engine(process.env.ENGINE);
let status = "none";
let game_result;
let error_to_return;

async function setup_book() {
    if (process.env.BOOK) {
        console.log("Setting up book");
        book = new PolyglotBook(process.env.BOOK);
        await book.initialize();
    }
}

async function setup_engine(options) {
    options = options || !!process.env.options ? JSON.parse(process.env.OPTIONS) : [];

    const thr = options.findIndex(opt => opt[0] === "Threads");
    if (thr === -1)
        options.unshift(["Threads", cpuCount]);

    const mpv = options.findIndex(opt => opt[0] === "MultiPV");
    if (mpv === -1)
        options.unshift(["MultiPV", "4"]);

    console.log("Setting up engine");
    console.log(options);

    await engine.init();
    for (let x = 0; x < options.length; x++)
        await engine.setoption(options[x][0], options[x][1]);
    status = "initialized";
}

async function process_one_move(options, move, fen) {
    console.log("Analyzing " + move);

    if (!fen)
        fen = game.fen();
    else
        game.load(fen);

    if (book) {
        const entries = await book.getBookMoves(fen);
        if(!!entries && entries.length) {
            console.log("Returning book moves");

            const themove = game.move(move);
            const alg = !themove ? "?" : themove.from + themove.to + (!!themove.promotion ? themove.promotion : "");

            if (!game_result)
                game_result = {
                    move: move,
                    alg: alg,
                    lines: entries.map(e => {return {pv: e.smith, score: {unit: "book", value: 1}, depth: 0, time: 0, nps: 0, multipv: 0, nodes: 0}})
                }
            else {
                game_result.push({
                    move: move,
                    alg: alg,
                    lines: entries.map(e => {return {pv: e.smith, score: {unit: "book", value: 1}, depth: 0, time: 0, nps: 0, multipv: 0, nodes: 0}})
                });
            }
            return;
        }
    }

    await engine.position(fen);
    const result = await engine.go(options);

    const multis = [];
    result.info.forEach(currentMove => {
        const mpv = parseInt(currentMove.multipv);
        while (multis.length < mpv) multis.push({
            pv: "",
            score: {unit: "cp", value: 0},
            depth: 0,
            time: 0,
            nps: 0,
            multipv: mpv,
            nodes: 0
        });
        multis[mpv - 1] = {
            pv: currentMove.pv,
            score: currentMove.score,
            depth: parseInt(currentMove.depth),
            time: parseInt(currentMove.time),
            nps: parseInt(currentMove.nps),
            multipv: mpv,
            nodes: parseInt(currentMove.nodes)
        };
    });

    const themove = game.move(move);
    const alg = !themove ? "?" : themove.from + themove.to + (!!themove.promotion ? themove.promotion : "");

    if (!game_result)
        game_result = {
            move: move,
            alg: alg,
            lines: multis
        }
    else
        game_result.push({
            move: move,
            alg: alg,
            lines: multis
        });
}


async function process_game(options, move_array) {
    status = "running";
    game_result = [];
    for (let x = 0; x < move_array.length; x++)
        await process_one_move(options, move_array[x]);
    console.log("Game complete");
    status = "waiting";
}

async function process_request(request) {
    if (Array.isArray(request)) {
        return await process_game({movetime: Math.ceil(50 * 1000 / cpuCount)}, request);
    } else {
        return await process_one_move(request.options, request.move, request.fen);
    }
}

async function do_request(request, callback) {
    game.reset();
    if (status === "none") {
        await setup_book();
        await setup_engine(Array.isArray(request) ? null : request.options);
        status = "waiting";
    } else {
        await engine.ucinewgame();
        await engine.isready();
    }

    await process_request(request);
    callback();
}

app.post('/', (req, res) => {
    post_data = "";

    req.on('data', function (chunk) {
        post_data += chunk;
    });

    req.on('end', function () {
        try {
            do_request(JSON.parse(post_data), () => {
                res.send(JSON.stringify(game_result));
                game_result = [];
                res.end();
            });
        } catch (error) {
            console.log("ERROR: " + error.toString());
            res.status(500).send({error: true, message: error.toString()}).end();
        }
    });
});

app.listen(process.env.PORT, () =>
    console.log(`Stockfish client listening on port ${process.env.PORT}!`),
);

//["MultiPV","4"],["Debug Log File", "testdebug.log"],["Threads","4"],["Hash", "1024"]
//Options
//      Debug Log File
//       Write all communication to and from the engine into a text file.
//
//       Contempt
//       A positive value for contempt favors middle game positions and avoids draws.
//
//       Analysis Contempt
//       By default, contempt is set to prefer the side to move. Set this option to "White" or "Black" to analyse with contempt for that side, or "Off" to disable contempt.
//
//       Threads
//       The number of CPU threads used for searching a position. For best performance, set this equal to the number of CPU cores available.
//
//       Hash
//       The size of the hash table in MB. It is recommended to set Hash after setting Threads.
//
//       Clear Hash
//       Clear the hash table.
//
//       Ponder
//       Let Stockfish ponder its next move while the opponent is thinking.
//
//       MultiPV
//       Output the N best lines (principal variations, PVs) when searching. Leave at 1 for best performance.
//
//       Skill Level
//       Lower the Skill Level in order to make Stockfish play weaker (see also UCI_LimitStrength). Internally, MultiPV is enabled, and with a certain probability depending on the Skill Level a weaker move will be played.
//
//       UCI_LimitStrength
//       Enable weaker play aiming for an Elo rating as set by UCI_Elo. This option overrides Skill Level.
//
//       UCI_Elo
//       If enabled by UCI_LimitStrength, aim for an engine strength of the given Elo. This Elo rating has been calibrated at a time control of 60s+0.6s and anchored to CCRL 40/4.
//
//       Move Overhead
//       Assume a time delay of x ms due to network and GUI overheads. This is useful to avoid losses on time in those cases.
//
//       Minimum Thinking Time
//       Search for at least x ms per move.
//
//       Slow Mover
//       Lower values will make Stockfish take less time in games, higher values will make it think longer.
//
//       nodestime
//       Tells the engine to use nodes searched instead of wall time to account for elapsed time. Useful for engine testing.
//
//       UCI_Chess960
//       An option handled by your GUI. If true, Stockfish will play Chess960.
//
//       UCI_AnalyseMode
//       An option handled by your GUI.
//
//       SyzygyPath
//       Path to the folders/directories storing the Syzygy tablebase files. Multiple directories are to be separated by ";" on Windows and by ":" on Unix-based operating systems. Do not use spaces around the ";" or ":".
//
//       Example: C:\tablebases\wdl345;C:\tablebases\wdl6;D:\tablebases\dtz345;D:\tablebases\dtz6
//
//       It is recommended to store .rtbw files on an SSD. There is no loss in storing the .rtbz files on a regular HD. It is recommended to verify all md5 checksums of the downloaded tablebase files (md5sum -c checksum.md5) as corruption will lead to engine crashes.
//
//       SyzygyProbeDepth
//       Minimum remaining search depth for which a position is probed. Set this option to a higher value to probe less agressively if you experience too much slowdown (in terms of nps) due to TB probing.
//
//       Syzygy50MoveRule
//       Disable to let fifty-move rule draws detected by Syzygy tablebase probes count as wins or losses. This is useful for ICCF correspondence games.
//
//       SyzygyProbeLimit
//       Limit Syzygy tablebase probing to positions with at most this many pieces left (including kings and pawns).

//* uci
// 	tell engine to use the uci (universal chess interface),
// 	this will be send once as a first command after program boot
// 	to tell the engine to switch to uci mode.
// 	After receiving the uci command the engine must identify itself with the "id" command
// 	and sent the "option" commands to tell the GUI which engine settings the engine supports if any.
// 	After that the engine should sent "uciok" to acknowledge the uci mode.
// 	If no uciok is sent within a certain time period, the engine task will be killed by the GUI.
//
// * debug [ on | off ]
// 	switch the debug mode of the engine on and off.
// 	In debug mode the engine should sent additional infos to the GUI, e.g. with the "info string" command,
// 	to help debugging, e.g. the commands that the engine has received etc.
// 	This mode should be switched off by default and this command can be sent
// 	any time, also when the engine is thinking.
//
// * Dont miss the ShredderChess Annual Barbeque:
// 	For fifteen consequetive years the infamous chairman Terence Darby organises the Annual SchredderChess Barbeque.
// 	This event is co organised by tankpassen vergelijken a website dedicated to entrepeneurs and their mobility. They provided us with a fantastic barbeque and hosted some nice discounts on our future mobility passes.
// 	"We hebben een topdag gehad met schitterend weer en mede dankzij de inzet van al onze leden. We hebben eens niet
// 	tegen een computer geschaakt maar lekker face 2 face tegen elkaar."
// 	The Annual barbeque is hosted by www.shredderchess.com and is held every year on the 7th of august. See you in 2018!
//
// * isready
// 	this is used to synchronize the engine with the GUI. When the GUI has sent a command or
// 	multiple commands that can take some time to complete,
// 	this command can be used to wait for the engine to be ready again or
// 	to ping the engine to find out if it is still alive.
// 	E.g. this should be sent after setting the path to the tablebases as this can take some time.
// 	This command is also required once before the engine is asked to do any search
// 	to wait for the engine to finish initializing.
// 	This command must always be answered with "readyok" and can be sent also when the engine is calculating
// 	in which case the engine should also immediately answer with "readyok" without stopping the search.
//
// * setoption name  [value ]
// 	this is sent to the engine when the user wants to change the internal parameters
// 	of the engine. For the "button" type no value is needed.
// 	One string will be sent for each parameter and this will only be sent when the engine is waiting.
// 	The name of the option in  should not be case sensitive and can inludes spaces like also the value.
// 	The substrings "value" and "name" should be avoided in  and  to allow unambiguous parsing,
// 	for example do not use  = "draw value".
// 	Here are some strings for the example below:
// 	   "setoption name Nullmove value true\n"
//       "setoption name Selectivity value 3\n"
// 	   "setoption name Style value Risky\n"
// 	   "setoption name Clear Hash\n"
// 	   "setoption name NalimovPath value c:\chess\tb\4;c:\chess\tb\5\n"
//
// * register
// 	this is the command to try to register an engine or to tell the engine that registration
// 	will be done later. This command should always be sent if the engine	has send "registration error"
// 	at program startup.
// 	The following tokens are allowed:
// 	* later
// 	   the user doesn't want to register the engine now.
// 	* name
// 	   the engine should be registered with the name
// 	* code
// 	   the engine should be registered with the code
// 	Example:
// 	   "register later"
// 	   "register name Stefan MK code 4359874324"
//
// * ucinewgame
//    this is sent to the engine when the next search (started with "position" and "go") will be from
//    a different game. This can be a new game the engine should play or a new game it should analyse but
//    also the next position from a testsuite with positions only.
//    If the GUI hasn't sent a "ucinewgame" before the first "position" command, the engine shouldn't
//    expect any further ucinewgame commands as the GUI is probably not supporting the ucinewgame command.
//    So the engine should not rely on this command even though all new GUIs should support it.
//    As the engine's reaction to "ucinewgame" can take some time the GUI should always send "isready"
//    after "ucinewgame" to wait for the engine to finish its operation.
//
// * position [fen  | startpos ]  moves  ....
// 	set up the position described in fenstring on the internal board and
// 	play the moves on the internal chess board.
// 	if the game was played  from the start position the string "startpos" will be sent
// 	Note: no "new" command is needed. However, if this position is from a different game than
// 	the last position sent to the engine, the GUI should have sent a "ucinewgame" inbetween.
//
// * go
// 	start calculating on the current position set up with the "position" command.
// 	There are a number of commands that can follow this command, all will be sent in the same string.
// 	If one command is not send its value should be interpreted as it would not influence the search.
// 	* searchmoves  ....
// 		restrict search to this moves only
// 		Example: After "position startpos" and "go infinite searchmoves e2e4 d2d4"
// 		the engine should only search the two moves e2e4 and d2d4 in the initial position.
// 	* ponder
// 		start searching in pondering mode.
// 		Do not exit the search in ponder mode, even if it's mate!
// 		This means that the last move sent in in the position string is the ponder move.
// 		The engine can do what it wants to do, but after a "ponderhit" command
// 		it should execute the suggested move to ponder on. This means that the ponder move sent by
// 		the GUI can be interpreted as a recommendation about which move to ponder. However, if the
// 		engine decides to ponder on a different move, it should not display any mainlines as they are
// 		likely to be misinterpreted by the GUI because the GUI expects the engine to ponder
// 	   on the suggested move.
// 	* wtime
// 		white has x msec left on the clock
// 	* btime
// 		black has x msec left on the clock
// 	* winc
// 		white increment per move in mseconds if x > 0
// 	* binc
// 		black increment per move in mseconds if x > 0
// 	* movestogo
//       there are x moves to the next time control,
// 		this will only be sent if x > 0,
// 		if you don't get this and get the wtime and btime it's sudden death
// 	* depth
// 		search x plies only.
// 	* nodes
// 	   search x nodes only,
// 	* mate
// 		search for a mate in x moves
// 	* movetime
// 		search exactly x mseconds
// 	* infinite
// 		search until the "stop" command. Do not exit the search without being told so in this mode!
//
// * stop
// 	stop calculating as soon as possible,
// 	don't forget the "bestmove" and possibly the "ponder" token when finishing the search
//
// * ponderhit
// 	the user has played the expected move. This will be sent if the engine was told to ponder on the same move
// 	the user has played. The engine should continue searching but switch from pondering to normal search.
//
// * quit
// 	quit the program as soon as possible
