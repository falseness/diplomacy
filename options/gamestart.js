class GameManager {
	static clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0

        this.clearBasisValues()
    }
    static clearBasisValues() {
        gameExit = false
        menu.visible = false

		canvas = {
            offset: {
                x: 0,
                y: 0
            },
            scale: 1
        }
        width = WIDTH
        height = HEIGHT
        mainCtx.setTransform(1, 0, 0, 1, 0, 0)
        gameEvent.screen.stop()
        
        let grid_min_size = Math.min(grid.arr.length, grid.arr[0].length)
        console.log(grid_min_size)
        mapBorder = {
	        left: 0,
	        right: grid.right,
	        top: 0,
	        bottom: grid.bottom,
	        scale: {
	            min: 1 / grid_min_size * 5, //0.275,
	            max: 1
	        }
	    }
	    createEvents()
    }
	static load() {
        this.clearBasisValues()
        
        nextTurnButton.color = players[whooseTurn].hexColor
        nextTurnPauseInterface.visible = true

    	requestAnimationFrame(gameLoop)
	}
	static initValues() {
        whooseTurn = 0
        gameRound = 0
        nextTurn()
        //undoManager.clear()
	}
	static start1() {
        grid = new Grid(0, 0, {
            x: 20,
            y: 10
        })
        this.clearValues()
      	players = [
            (new NeutralPlayer({
                r: 208, 
                g: 208,
                b: 208
                }, 0)
            ),
            (new Player({
                r: 255,
                g: 0,
                b: 0 
                })
            ),
            (new Player({
                r: 98,
                g: 168,
                b: 222
                })
            )
        ]
        grid.arr[5][3].hexagon.firstpaint(1)

        new Lake(10, 4)
        new Lake(9, 5)
        new Mountain(8, 8)
        new Mountain(11, 1)

        new Mountain(1, 7)
        new Mountain(1, 8)
        new Mountain(2, 8)

        new Mountain(17, 1)
        new Mountain(18, 1)
        new Mountain(18, 2)

        let TOWN1 = new Town(5, 3, false, true)

        grid.arr[14][6].hexagon.firstpaint(2)

        let TOWN2 = new Town(14, 6, false, true)

        this.initValues()
        requestAnimationFrame(gameLoop)
	}
	static start2() {
        grid = new Grid(0, 0, {
            x: 30,
            y: 23
        })
        this.clearValues()
        players = [new NeutralPlayer({
            r: 208, 
            g: 208,
            b: 208
            }, 0), 
            new Player({
                r: 255,
                g: 0,
                b: 0 //98, 168, 222
            }),
            new Player({
                r: 98,
                g: 168,
                b: 222
            }),
            new Player({
                r: 0,
                g: 179,
                b: 0
            })
        ]
        grid.arr[9][6].hexagon.firstpaint(1)

        let TOWN1 = new Town(9, 6, false, true)

        grid.arr[20][9].hexagon.firstpaint(2)

        let TOWN2 = new Town(20, 9, false, true)
        
        grid.arr[12][16].hexagon.firstpaint(3)

        let TOWN3 = new Town(12, 16, false, true)

        this.initValues()
        requestAnimationFrame(gameLoop)
    }
    static start3() {
        grid = new Grid(0, 0, {
            x: 29,
            y: 23
        })
        this.clearValues()
        players = [new NeutralPlayer({
            r: 208, 
            g: 208,
            b: 208
            }, 0), 
            new Player({
                r: 255,
                g: 0,
                b: 0 //98, 168, 222
            }),
            new Player({
                r: 51,
                g: 153,
                b: 255
            }),
            new Player({
                r: 0,
                g: 179,
                b: 0
            }),
            new Player({
                r: 112,
                g: 0,
                b: 204
            })
        ]

        grid.arr[9][6].hexagon.firstpaint(1)

        let TOWN1 = new Town(9, 6, false, true)

        grid.arr[19][6].hexagon.firstpaint(2)

        let TOWN2 = new Town(19, 6, false, true)
        
        grid.arr[9][16].hexagon.firstpaint(4)

        let TOWN3 = new Town(9, 16, false, true)

        grid.arr[19][16].hexagon.firstpaint(3)

        let TOWN4 = new Town(19, 16, false, true)

        this.initValues()
        requestAnimationFrame(gameLoop)
    }
    static start4() {
        grid = new Grid(0, 0, {
            x: 31,
            y: 21
        })
        this.clearValues()
      	players = [
            (new NeutralPlayer({
                r: 208, 
                g: 208,
                b: 208
                }, 0)
            ),
            (new Player({
                r: 255,
                g: 0,
                b: 0 
                })
            ),
            (new Player({
                r: 98,
                g: 168,
                b: 222
                })
            )
        ]

        new Lake(11, 15)
        new Lake(12, 15)
        new Lake(13, 14)

        new Lake(11, 4)
        new Lake(12, 5)
        new Lake(13, 5)

        new Lake(17, 14)
        new Lake(18, 15)
        new Lake(19, 15)

        new Lake(17, 5)
        new Lake(18, 5)
        new Lake(19, 4)

        new Lake(6, 11)
        new Lake(7, 11)
        new Lake(8, 12)
        new Lake(6, 12)
        new Lake(7, 12)

        new Lake(22, 8)
        new Lake(23, 8)
        new Lake(24, 9)
        new Lake(23, 7)
        new Lake(24, 8)

        new Mountain(15, 8)
        new Mountain(15, 11)

        new Mountain(7, 5)
        new Mountain(6, 6)
        new Mountain(5, 6)

        new Mountain(23, 14)
        new Mountain(24, 14)
        new Mountain(25, 13)

        new Mountain(29, 1)
        new Mountain(1, 19)
        new Mountain(1, 1)
        new Mountain(29, 19)


        grid.arr[8][10].hexagon.firstpaint(1)

        let TOWN1 = new Town(8, 10, false, true)

        grid.arr[22][10].hexagon.firstpaint(2)

        let TOWN2 = new Town(22, 10, false, true)

        this.initValues()
        requestAnimationFrame(gameLoop)
    }
    static start5() {
        grid = new Grid(0, 0, {
            x: 37,
            y: 29
        })
        this.clearValues()
        players = [new NeutralPlayer({
            r: 208, 
            g: 208,
            b: 208
            }, 0), 
            new Player({
                r: 255,
                g: 0,
                b: 0 //98, 168, 222
            }),
            new Player({
                r: 98,
                g: 168,
                b: 222
            }),
            new Player({
                r: 0,
                g: 179,
                b: 0
            })
        ]

        new Mountain(18, 15)
        new Mountain(20, 16)

        
        new Mountain(22, 13)
        new Mountain(22, 15)

        
        new Mountain(18, 13)
        new Mountain(20, 12)

        new Mountain(30, 11)
        new Mountain(31, 11)
        new Mountain(31, 12)

        new Mountain(12, 7)
        new Mountain(12, 8)
        new Mountain(13, 6)

        new Mountain(14, 21)
        new Mountain(14, 22)
        new Mountain(15, 22)

        /*new Lake(20, 18)
        new Lake(24, 16)
        new Lake(24, 12)
        new Lake(20, 10)
        new Lake(16, 12)
        new Lake(16, 16)

        new Lake(28, 20)
        new Lake(27, 20)
        new Lake(29, 20)
        new Lake(28, 21)

        new Lake(22, 6)
        new Lake(21, 5)
        new Lake(23, 5)
        new Lake(22, 5)

        new Lake(9, 14)
        new Lake(9, 15)
        new Lake(10, 15)
        new Lake(8, 15)*/

        new Town(8, 15, false, -1)

        new Town(24, 8, false, -1)

        new Town(28, 21, false, -1)


        new Goldmine(20, 14, false, -1)

        new Mountain(1, 1)
        new Mountain(2, 1)

        new Mountain(35, 1)

        new Mountain(1, 27)

        new Mountain(34, 27)
        new Mountain(35, 27)

        grid.arr[15][8].hexagon.firstpaint(1)

        let TOWN1 = new Town(15, 8, false, true)

        grid.arr[28][13].hexagon.firstpaint(2)

        let TOWN2 = new Town(28, 13, false, true)
        
        grid.arr[17][20].hexagon.firstpaint(3)

        let TOWN3 = new Town(17, 20, false, true)



        this.initValues()
        requestAnimationFrame(gameLoop)
    }
}
function gameLoop() {
    gameEvent.moveScreen()
    drawAll()
    if (gameExit) {
        gameExit = false
        return
    }
    requestAnimationFrame(gameLoop)
}