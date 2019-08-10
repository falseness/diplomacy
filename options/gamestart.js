class GameManager {
	static clearValues() {
		menu.setVisible(false)

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

        mapBorder = {
	        left: 0,
	        right: grid.right,
	        top: 0,
	        bottom: grid.bottom,
	        scale: {
	            min: 0.4,
	            max: 1
	        }
	    }
	    createEvents()
	    nextTurnButton.color = players[whooseTurn].hexColor
	}
	static load() {
		this.clearValues()
    	requestAnimationFrame(gameLoop)
	}
	static initValues() {
        whooseTurn = 1
        undoManager.clear()
	}
	static start1() {
      	players = [
            (new Player({
                r: 208, 
                g: 208,
                b: 208
                }, 0, true)
            ),
            (new Player({
                r: 255,
                g: 0,
                b: 0 
                }, 10)
            ),
            (new Player({
                r: 98,
                g: 168,
                b: 222
                }, 0)
            )
        ]
        grid = new Grid(0, 0, {
            x: 20,
            y: 10
        })
        grid.arr[5][3].hexagon.firstpaint(1)

        let TOWN1 = new Town(5, 3, false, true)

        grid.arr[14][6].hexagon.firstpaint(2)

        let TOWN2 = new Town(14, 6, false, true)

        this.initValues()
        this.clearValues()
        requestAnimationFrame(gameLoop)
	}
	static start2() {
        players = [new Player({
            r: 208, 
            g: 208,
            b: 208
            }, 0, true), 
            new Player({
                r: 255,
                g: 0,
                b: 0 //98, 168, 222
            }, 10),
            new Player({
                r: 98,
                g: 168,
                b: 222
            }, 0),
            new Player({
                r: 0,
                g: 179,
                b: 0
            }, 0)
        ]
        grid = new Grid(0, 0, {
            x: 30,
            y: 20
        })
        grid.arr[9][6].hexagon.firstpaint(1)

        let TOWN1 = new Town(9, 6, false, true)

        grid.arr[20][9].hexagon.firstpaint(2)

        let TOWN2 = new Town(20, 9, false, true)
        
        grid.arr[12][14].hexagon.firstpaint(3)

        let TOWN3 = new Town(12, 14, false, true)

        this.initValues()
        this.clearValues()
        requestAnimationFrame(gameLoop)
    }
    static start3() {
        players = [new Player({
            r: 208, 
            g: 208,
            b: 208
            }, 0, true), 
            new Player({
                r: 255,
                g: 0,
                b: 0 //98, 168, 222
            }, 10),
            new Player({
                r: 51,
                g: 153,
                b: 255
            }, 0),
            new Player({
                r: 0,
                g: 179,
                b: 0
            }, 0),
            new Player({
                r: 112,
                g: 0,
                b: 204
            }, 0)
        ]
        grid = new Grid(0, 0, {
            x: 29,
            y: 21
        })

        grid.arr[9][6].hexagon.firstpaint(1)

        let TOWN1 = new Town(9, 6, false, true)

        grid.arr[19][6].hexagon.firstpaint(2)

        let TOWN2 = new Town(19, 6, false, true)
        
        grid.arr[9][14].hexagon.firstpaint(4)

        let TOWN3 = new Town(9, 14, false, true)

        grid.arr[19][14].hexagon.firstpaint(3)

        let TOWN4 = new Town(19, 14, false, true)

        this.initValues()
        this.clearValues()
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