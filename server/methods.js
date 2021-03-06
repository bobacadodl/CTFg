var ChildProcess = Npm.require('child_process');
var Fiber = Npm.require('fibers');
var Future = Npm.require('fibers/future');
var path = Npm.require('path');



Meteor.methods({
    createTeam(teamName) {
        //if no team, and not a teacher..
        if(Meteor.user() && !Meteor.user().profile.team && !(Meteor.user().profile.type==="teacher")) {
            teamName = teamName.trim();
            if(teamName && teamName.length>5 && teamName.length<32 && teamName.match(/^[0-9a-zA-Z ]+$/)) {
                if(Teams.findOne({name: teamName})) {
                    throw new Meteor.Error("invalid-team", "That team name already exists! Please choose a different name.");
                }
                else {
                    var teamId = Teams.insert({
                        name: teamName,
                        score: 0,
                        members: [Meteor.userId()],
                        solves: [],
                        eligible: (Meteor.user().profile.type==="high" || Meteor.user().profile.type==="middle"),
                        code: "team_"+Random.id(32)
                    });
                    Meteor.users.update(Meteor.userId(), {$set: {"profile.team": teamId}});
                    return {message: "Team successfully created!"};
                }
            }
            else throw new Meteor.Error("invalid-name", "The provided team name is invalid. (Must be alphanumeric and longer than 5 letters)");
        }
        else throw new Meteor.Error("invalid-user", "The current user is invalid for creating a team.");
    },
    joinTeam(teamCode) {
        //if no team, and not a teacher..
        if(Meteor.user() && !Meteor.user().profile.team && !(Meteor.user().profile.type==="teacher")) {
            teamCode = teamCode.trim();
            var team = Teams.findOne({code: teamCode});
            if(team) {
                if(team.members.length<Meteor.settings.public.maxTeamSize) {
                    if(team.eligible && !(Meteor.user().profile.type==="middle" || Meteor.user().profile.type==="high")) {
                        //no longer eligible
                        Teams.update(team._id, {$push: {members: Meteor.userId()}, $set: {eligible: false}}     );
                    }
                    else {
                        //already ineligible. no need to update, or still eligible
                        Teams.update(team._id, {$push: {members: Meteor.userId()}});
                    }
                    Meteor.users.update(Meteor.userId(), {$set: {"profile.team": team._id}});
                    return {message: "You have successfully joined a team!"};
                }
                else throw new Meteor.Error("team-full", "The team you have attempted to join is full!");
            }
            else throw new Meteor.Error("invalid-code", "The provided team code does not correspond to any team.");
        }
        else throw new Meteor.Error("invalid-user", "The current user is invalid for joining a team.");
    },
    newTeamCode() {
        if(Meteor.user() && Meteor.user().profile.team) {
            var team = Meteor.user().getTeam();
            if(team) {
                Teams.update(team._id, {$set: {code: "team_"+Random.id(32)}});
                return {message: "New team code generated."};
            }
            else throw new Meteor.Error("invalid-team", "The team was not found.");
        }
        else throw new Meteor.Error("invalid-user", "The current user is invalid for team settings.");
    },
    setSchoolName(school) {
        if(Meteor.user() && Meteor.user().profile.team) {
            school = school.trim();
            if(school && school.length>=5 && school.length<=32 && school.match(/^[0-9a-zA-Z ]+$/)) {
                var team = Teams.findOne({_id: Meteor.user().profile.team});
                if(team) {
                    Teams.update(team._id, {$set: {school: school}});
                    return {message: "Team school set."};
                }
                else throw new Meteor.Error("invalid-team", "The user's team was not found.");
            }
            else throw new Meteor.Error("invalid-name", "The provided school name is invalid. (Must be alphanumeric and longer than 5 letters)");
        }
        else throw new Meteor.Error("invalid-user", "The current user is invalid for team settings.");
    },
    submitProgram(probId, program, lang) {
        var currentDate = Date.now();
        if(currentDate > Meteor.settings.public.startTime) {
            if(currentDate < Meteor.settings.public.endTime) {
                if(Meteor.user() && Meteor.user().profile.team) {
                    //TODO restrict program size
                    if(_.isString(program) && !_.isEmpty(program)) {
                        if(program.length>=10000) throw new Meteor.Error("too-large", "Submitted program is too large!");
                        var team = Teams.findOne({_id: Meteor.user().profile.team});
                        if(team) {
                            if(!team.hasSolved(probId)) {
                                var problem = Problems.findOne({id: probId});
                                if(problem) {
                                    if(problem.allowedLanguages && problem.allowedLanguages.indexOf(lang)==-1) {
                                        throw new Meteor.Error("invalid-language","Invalid language selection.");
                                    }

                                    var submission = ProgrammingSubmissions.insert({problem: probId, program: program, team: Meteor.user().profile.team, submitTime: currentDate, language: lang, result: {completed: false}});
                                    if(submission) {
                                        console.log("Sending program to grading server: "+Meteor.settings.gradingServer);
                                        HTTP.call( 'POST', Meteor.settings.gradingServer, {
                                            data: {
                                                program: program,
                                                lang: lang,
                                                pid: problem.id,
                                                grader: problem.grader,
                                                tid: Meteor.user().profile.team
                                            }
                                        }, function( error, response ) {
                                            if ( error ) {
                                                console.error(error);
                                            } else {
                                                console.log( "Sent program to grading server" );
                                            }
                                        });
                                        return {message: "Program successfully submitted for grading."};
                                    }
                                    else throw new Meteor.Error("invalid-submission", "Invalid submission properties!");
                                }
                                else throw new Meteor.Error("invalid-problem", "Invalid problem ID!");
                            }
                            else throw new Meteor.Error("already-solved", "Your team has already solved this problem.");
                        }
                        else throw new Meteor.Error("invalid-team", "The user's team was not found.");
                    }
                    else throw new Meteor.Error("invalid-answer", "The provided answer was empty.");
                }
                else throw new Meteor.Error("invalid-user", "The current user is invalid for submitting problem answers.");
            }
            else throw new Meteor.Error("already-ended", "The contest has ended! Problem submissions are no longer allowed.");
        }
        else throw new Meteor.Error("not-started", "The contest has not started yet!");
    },
    submitAnswer(probId, answer) {
        var currentDate = Date.now();
        if(currentDate > Meteor.settings.public.startTime) {
            if(currentDate < Meteor.settings.public.endTime) {
                if(Meteor.user() && Meteor.user().profile.team) {
                    if(_.isString(answer) && !_.isEmpty(answer)) {
                        answer = answer.trim();
                        var team = Teams.findOne({_id: Meteor.user().profile.team});
                        if(team) {
                            if(!team.hasSolved(probId)) {
                                var problem = Problems.findOne({id: probId});
                                if(problem) {
                                    
                                    //console.log("problem found");
                                    var fut = new Future();
                                    var graderFile;
                                    if(Meteor.settings.graderPath) {
                                        graderFile = path.join(Meteor.settings.graderPath, problem.grader);
                                    }
                                    else {
                                        graderFile = path.join(Meteor.rootPath, "private/graders", problem.grader);
                                    }

                                    if(problem.grader.endsWith(".js")) {
                                        //console.log("spawning child process...");
                                        const child = ChildProcess.fork(graderFile);
                                        child.on('message', function(m) {
                                            // Receive results from child process
                                            //console.log('received: ' + m);
                                            new Fiber(function() {
                                                fut.return(m);
                                            }).run();
                                        });

                                        // Send child process some work
                                        child.send(answer);
                                    }
                                    else if(problem.grader.endsWith(".py")){
                                        var pythonPath = Meteor.settings.pythonPath;
                                        //console.log("executing file...");
                                        const child = ChildProcess.execFile(pythonPath, [graderFile], function(error, stdout, stderr) {
                                            new Fiber(function() {
                                                fut.return(JSON.parse(stdout.toString().trim()));
                                            }).run();
                                        });
                                        child.stdin.write(answer);
                                        child.stdin.end();
                                    }
                                    var result = fut.wait();
                                    if(result.correct) {
                                        //SOLVED PROBLEM
                                        team.addSolve(problem);
                                    }
                                    return result;
                                }
                                else throw new Meteor.Error("invalid-problem", "Invalid problem ID!");
                            }
                            else throw new Meteor.Error("already-solved", "Your team has already solved this problem.");
                        }
                        else throw new Meteor.Error("invalid-team", "The user's team was not found.");
                    }
                    else throw new Meteor.Error("invalid-answer", "The provided answer was empty.");
                }
                else throw new Meteor.Error("invalid-user", "The current user is invalid for submitting problem answers.");
            }
            else throw new Meteor.Error("already-ended", "The contest has ended! Problem submissions are no longer allowed.");
        }
        else throw new Meteor.Error("not-started", "The contest has not started yet!");
    }
});